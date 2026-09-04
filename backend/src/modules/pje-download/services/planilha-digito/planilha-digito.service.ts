import type {
  GerarPlanilhaDigitoDTO, PesosPrioridade,
  PlanilhaDigitoProgress, PlanilhaDigitoResumo, ProcessoDigito,
} from '../../../../shared/types';
import { pjeApiGet, pjeApiPost, type PjeSession } from '../../../../shared/pje-api-client';
import { resolveSessionFromDto } from '../pje-auth';
import { listarProcessosDaTarefa } from '../download/painel-listing';
import {
  FLAGS, PESOS_PRIORIDADE_PADRAO,
  calcularDiasParados, calcularPontuacao, classificarPrioridade,
  distribuirPorServidor, detectarMetas, extrairDigito,
  montarMapaAtribuicoes, ordenarPorPrioridade, selecionarTarefas,
} from './digito-core';
import { gerarSaidaDigito } from './xlsx-digito-generator';

const ENRICH_CONCURRENCY = 4;
const STAGGER_MS = 250;
// Jobs terminais são varridos junto com o ciclo do GC de arquivos (30 min / 1 h).
const JOB_TTL_MS = 60 * 60 * 1000;
const JOB_SWEEP_INTERVAL_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extrai a data do payload de processos/{id}/ultimoMovimento sem depender do formato exato. */
export function extrairDataMovimento(payload: unknown): string | undefined {
  const candidato = Array.isArray(payload) ? payload[0] : payload;
  if (typeof candidato === 'string') {
    return /\d{4}-\d{2}-\d{2}/.test(candidato) ? candidato : undefined;
  }
  if (candidato && typeof candidato === 'object') {
    const obj = candidato as Record<string, unknown>;
    for (const chave of ['dataMovimento', 'data', 'dataHora', 'dataUltimoMovimento', 'dataCriacao']) {
      const valor = obj[chave];
      if (typeof valor === 'string' && valor.trim()) return valor;
      if (typeof valor === 'number' && Number.isFinite(valor)) return new Date(valor).toISOString();
    }
  }
  return undefined;
}

interface RegistroBruto {
  idProcesso: number;
  numeroProcesso: string;
  tarefaAtual: string;
  outrasTarefas: string[];
  etiquetas: string[];
  assuntoPrincipal?: string;
  classeJudicial?: string;
  dataChegada?: string;
}

function lerString(obj: Record<string, unknown>, chave: string): string | undefined {
  const v = obj[chave];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function lerEtiquetas(row: Record<string, unknown>): string[] {
  const lista = row['tagsProcessoList'];
  if (Array.isArray(lista)) {
    const nomes = lista
      .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>)['nomeTag'] : undefined))
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    if (nomes.length > 0) return nomes;
  }
  const tagsList = row['tagsList'];
  if (Array.isArray(tagsList)) {
    return tagsList.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  }
  return [];
}

export class PlanilhaDigitoService {
  private cancelledJobs = new Set<string>();
  private progressMap = new Map<string, PlanilhaDigitoProgress>();

  constructor() {
    // progressMap sem TTL foi apontado como dívida na planilha de advogados — aqui os
    // jobs terminais expiram junto com os arquivos gerados.
    const sweeper = setInterval(() => this.sweepExpiredJobs(), JOB_SWEEP_INTERVAL_MS);
    if (typeof sweeper.unref === 'function') sweeper.unref();
  }

  private sweepExpiredJobs(): void {
    const limite = Date.now() - JOB_TTL_MS;
    for (const [jobId, progress] of this.progressMap) {
      const terminal = ['completed', 'failed', 'cancelled'].includes(progress.status);
      if (terminal && progress.timestamp < limite) this.progressMap.delete(jobId);
    }
  }

  cancel(jobId: string): void {
    this.cancelledJobs.add(jobId);
    const current = this.progressMap.get(jobId);
    if (current && !['completed', 'failed', 'cancelled'].includes(current.status)) {
      this.progressMap.set(jobId, {
        ...current,
        status: 'cancelling',
        message: 'Cancelamento solicitado — interrompendo processamento...',
        timestamp: Date.now(),
      });
    }
  }

  isCancelled(jobId: string): boolean { return this.cancelledJobs.has(jobId); }
  getProgress(jobId: string): PlanilhaDigitoProgress | null { return this.progressMap.get(jobId) ?? null; }

  async gerar(jobId: string, dto: GerarPlanilhaDigitoDTO): Promise<void> {
    const emit = (p: Omit<PlanilhaDigitoProgress, 'jobId' | 'timestamp'>) =>
      this.progressMap.set(jobId, { ...p, jobId, timestamp: Date.now() });

    const emitCancelled = (total: number, processed: number) => emit({
      status: 'cancelled', progress: 0, totalProcesses: total, processedCount: processed,
      message: 'Geração cancelada pelo usuário.',
    });

    try {
      const pesos: PesosPrioridade = { ...PESOS_PRIORIDADE_PADRAO, ...(dto.pesos ?? {}) };
      const mapa = montarMapaAtribuicoes(dto.atribuicoes);

      const session = await resolveSessionFromDto(dto);

      emit({
        status: 'listing', progress: 3, totalProcesses: 0, processedCount: 0,
        message: 'Consultando tarefas do painel...',
      });

      const tarefasIncluidas = await this.listarTarefasDoPainel(session, dto.tarefasIgnoradas ?? []);
      if (this.isCancelled(jobId)) { emitCancelled(0, 0); return; }
      if (tarefasIncluidas.length === 0) {
        emit({
          status: 'failed', progress: 0, totalProcesses: 0, processedCount: 0,
          message: 'Nenhuma tarefa disponível no painel após aplicar as tarefas ignoradas.',
        });
        return;
      }

      const registros = await this.listarAcervo(session, tarefasIncluidas, jobId, (feitas) => {
        emit({
          status: 'listing',
          progress: 3 + Math.round((feitas / tarefasIncluidas.length) * 27),
          totalProcesses: 0, processedCount: 0,
          message: `Listando processos: tarefa ${feitas}/${tarefasIncluidas.length}...`,
        });
      });
      if (this.isCancelled(jobId)) { emitCancelled(registros.length, 0); return; }

      if (registros.length === 0) {
        emit({
          status: 'completed', progress: 100, totalProcesses: 0, processedCount: 0,
          message: 'Nenhum processo encontrado nas tarefas consideradas.',
        });
        return;
      }

      emit({
        status: 'enriching', progress: 30, totalProcesses: registros.length, processedCount: 0,
        message: `Consultando última movimentação de ${registros.length} processos...`,
      });

      const agora = new Date();
      const processos = await this.enriquecerParalelo(session, registros, jobId, agora, pesos, (feitos, atual) => {
        emit({
          status: 'enriching',
          progress: 30 + Math.round((feitos / registros.length) * 60),
          totalProcesses: registros.length, processedCount: feitos, currentProcess: atual,
          message: `Última movimentação ${feitos}/${registros.length}: ${atual}`,
        });
      });
      if (this.isCancelled(jobId)) { emitCancelled(registros.length, processos.length); return; }

      emit({
        status: 'generating', progress: 92, totalProcesses: registros.length,
        processedCount: registros.length, message: 'Gerando planilha...',
      });

      const distribuicao = distribuirPorServidor(processos, mapa);
      for (const [servidor, lista] of distribuicao.porServidor) {
        distribuicao.porServidor.set(servidor, ordenarPorPrioridade(lista));
      }
      distribuicao.naoAtribuidos = ordenarPorPrioridade(distribuicao.naoAtribuidos);

      const digitosPorServidor = new Map<string, number[]>();
      for (const [digito, servidor] of [...mapa.entries()].sort((a, b) => a[0] - b[0])) {
        digitosPorServidor.set(servidor, [...(digitosPorServidor.get(servidor) ?? []), digito]);
      }

      const { fileName } = await gerarSaidaDigito(distribuicao, digitosPorServidor, dto.formato, jobId, pesos);

      const resumo = this.montarResumo(distribuicao, digitosPorServidor, mapa);
      emit({
        status: 'completed', progress: 100, totalProcesses: registros.length,
        processedCount: registros.length, fileName, resumo,
        message: `Planilha gerada: ${registros.length} processos distribuídos entre ${distribuicao.porServidor.size} servidor(es)`
          + (resumo.naoAtribuidos.total > 0 ? ` (+${resumo.naoAtribuidos.total} não atribuídos).` : '.'),
      });
    } catch (err) {
      if (this.isCancelled(jobId)) { emitCancelled(0, 0); return; }
      emit({
        status: 'failed', progress: 0, totalProcesses: 0, processedCount: 0,
        message: err instanceof Error ? err.message : 'Erro ao gerar planilha por dígito',
      });
      throw err;
    } finally {
      this.cancelledJobs.delete(jobId);
    }
  }

  private async listarTarefasDoPainel(session: PjeSession, ignoradas: string[]): Promise<string[]> {
    const resposta = await pjeApiPost<unknown>(session, 'painelUsuario/tarefas', {
      numeroProcesso: '', competencia: '', etiquetas: [],
    });
    const nomes = (Array.isArray(resposta) ? resposta : [])
      .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>)['nome'] : undefined))
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    return selecionarTarefas(nomes, ignoradas);
  }

  private async listarAcervo(
    session: PjeSession,
    tarefas: string[],
    jobId: string,
    onTarefaConcluida: (feitas: number) => void,
  ): Promise<RegistroBruto[]> {
    // Dedup pelos dígitos do número CNJ: processo presente em mais de uma tarefa
    // entra uma vez, com as demais tarefas registradas em outrasTarefas.
    const porNumero = new Map<string, RegistroBruto>();
    let feitas = 0;

    for (const tarefa of tarefas) {
      if (this.isCancelled(jobId)) break;
      await listarProcessosDaTarefa(
        session, tarefa, false,
        (row) => {
          const numero = lerString(row, 'numeroProcesso');
          const idProcesso = typeof row['idProcesso'] === 'number' ? row['idProcesso'] : 0;
          if (!numero || !idProcesso) return;
          const chave = numero.replace(/\D/g, '');
          const existente = porNumero.get(chave);
          if (existente) {
            if (existente.tarefaAtual !== tarefa && !existente.outrasTarefas.includes(tarefa)) {
              existente.outrasTarefas.push(tarefa);
            }
            return;
          }
          porNumero.set(chave, {
            idProcesso,
            numeroProcesso: numero,
            tarefaAtual: lerString(row, 'nomeTarefa') ?? tarefa,
            outrasTarefas: [],
            etiquetas: lerEtiquetas(row),
            assuntoPrincipal: lerString(row, 'assuntoPrincipal'),
            classeJudicial: lerString(row, 'classeJudicial'),
            dataChegada: lerString(row, 'dataChegada'),
          });
        },
        () => this.isCancelled(jobId),
      );
      feitas++;
      onTarefaConcluida(feitas);
    }

    return [...porNumero.values()];
  }

  private async enriquecerParalelo(
    session: PjeSession,
    registros: RegistroBruto[],
    jobId: string,
    agora: Date,
    pesos: PesosPrioridade,
    onProgress: (feitos: number, atual: string) => void,
  ): Promise<ProcessoDigito[]> {
    const resultados: ProcessoDigito[] = new Array<ProcessoDigito>(registros.length);
    let feitos = 0;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        if (this.isCancelled(jobId)) return;
        const idx = nextIndex++;
        if (idx >= registros.length) return;
        const registro = registros[idx];
        if (idx > 0) await sleep(STAGGER_MS);
        if (this.isCancelled(jobId)) return;

        let dataMovimento: string | undefined;
        try {
          const payload = await pjeApiGet<unknown>(session, `processos/${registro.idProcesso}/ultimoMovimento`);
          dataMovimento = extrairDataMovimento(payload);
        } catch {
          dataMovimento = undefined;
        }

        resultados[idx] = this.montarProcesso(registro, dataMovimento, agora, pesos);
        feitos++;
        onProgress(feitos, registro.numeroProcesso);
      }
    };

    await Promise.all(Array.from(
      { length: Math.min(ENRICH_CONCURRENCY, registros.length) },
      () => worker(),
    ));

    // Slots não processados (cancelamento no meio do lote) ainda entram na planilha.
    for (let i = 0; i < registros.length; i++) {
      if (!resultados[i]) resultados[i] = this.montarProcesso(registros[i], undefined, agora, pesos);
    }
    return resultados;
  }

  private montarProcesso(
    registro: RegistroBruto,
    dataMovimento: string | undefined,
    agora: Date,
    pesos: PesosPrioridade,
  ): ProcessoDigito {
    const { digito, ano } = extrairDigito(registro.numeroProcesso);
    const flags: string[] = [];

    // Sem última movimentação disponível, os dias contam da chegada na tarefa
    // (sinalizado por flag) — melhor um número conservador do que derrubar o lote.
    let dataBase = dataMovimento;
    if (!dataBase && registro.dataChegada) {
      dataBase = registro.dataChegada;
      flags.push(FLAGS.SEM_ULTIMO_MOVIMENTO);
    }
    const diasParados = calcularDiasParados(dataBase, agora);
    if (dataBase === undefined && diasParados === null) flags.push(FLAGS.SEM_ULTIMO_MOVIMENTO);

    const metas = detectarMetas(registro.etiquetas, pesos);
    if ((diasParados ?? 0) >= pesos.limiarTempoMortoDias) flags.push(FLAGS.TEMPO_MORTO_CNJ);
    if (!registro.assuntoPrincipal) flags.push(FLAGS.ASSUNTO_AUSENTE);

    const base = { metas, diasParados, anoCnj: ano };
    return {
      idProcesso: registro.idProcesso,
      numeroProcesso: registro.numeroProcesso,
      digito,
      anoCnj: ano,
      tarefaAtual: registro.tarefaAtual,
      outrasTarefas: registro.outrasTarefas,
      etiquetas: registro.etiquetas,
      assuntoPrincipal: registro.assuntoPrincipal,
      classeJudicial: registro.classeJudicial,
      dataUltimoMovimento: dataMovimento,
      diasParados,
      metas,
      prioridade: classificarPrioridade(base, pesos),
      pontuacao: calcularPontuacao(base, pesos, agora.getFullYear()),
      flags,
    };
  }

  private montarResumo(
    distribuicao: ReturnType<typeof distribuirPorServidor>,
    digitosPorServidor: Map<string, number[]>,
    mapa: Map<number, string>,
  ): PlanilhaDigitoResumo {
    const digitosSemServidor = new Set<number>();
    let malformados = 0;
    for (const proc of distribuicao.naoAtribuidos) {
      if (proc.digito === null) malformados++;
      else if (!mapa.has(proc.digito)) digitosSemServidor.add(proc.digito);
    }

    let semEtiquetaServidor = 0;
    let etiquetaDivergente = 0;
    for (const lista of distribuicao.porServidor.values()) {
      for (const proc of lista) {
        if (proc.flags.includes(FLAGS.SEM_ETIQUETA_SERVIDOR)) semEtiquetaServidor++;
        if (proc.flags.includes(FLAGS.ETIQUETA_DIVERGENTE)) etiquetaDivergente++;
      }
    }

    return {
      porServidor: [...distribuicao.porServidor.entries()].map(([servidor, lista]) => ({
        servidor,
        digitos: digitosPorServidor.get(servidor) ?? [],
        total: lista.length,
      })),
      naoAtribuidos: {
        total: distribuicao.naoAtribuidos.length,
        digitosSemServidor: [...digitosSemServidor].sort((a, b) => a - b),
      },
      semEtiquetaServidor,
      etiquetaDivergente,
      malformados,
    };
  }
}
