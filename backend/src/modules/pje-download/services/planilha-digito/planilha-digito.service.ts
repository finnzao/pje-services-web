import type {
  ConfigPeso, GerarPlanilhaDigitoDTO,
  PlanilhaDigitoProgress, PlanilhaDigitoResumo, ProcessoDigito,
} from '../../../../shared/types';
import { pjeApiGet, pjeApiPost, type PjeSession } from '../../../../shared/pje-api-client';
import { resolveSessionFromDto } from '../pje-auth';
import { listarProcessosDaTarefa } from '../download/painel-listing';
import {
  CONFIG_PESO_PADRAO, FLAGS,
  avaliarProcesso, calcularDiasParados, distribuirPorServidor, extrairDigito,
  metasDoProcesso, montarMapaAtribuicoes, ordenarPorPrioridade, parseDataPje,
  selecionarTarefas,
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
  const direto = parseDataPje(candidato);
  if (direto) return direto;
  if (candidato && typeof candidato === 'object') {
    const obj = candidato as Record<string, unknown>;
    for (const chave of ['dataMovimento', 'data', 'dataHora', 'dataUltimoMovimento', 'ultimoMovimento', 'dataCriacao']) {
      const parsed = parseDataPje(obj[chave]);
      if (parsed) return parsed;
    }
    const movimento = obj['movimento'];
    if (movimento && typeof movimento === 'object') return extrairDataMovimento(movimento);
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
  /** Presente quando a própria listagem do painel já trouxe a última movimentação. */
  ultimoMovimento?: string;
}

function lerString(obj: Record<string, unknown>, chave: string): string | undefined {
  const v = obj[chave];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** Primeira data parseável entre as chaves informadas (aceita epoch, ISO ou dd/MM/yyyy). */
function lerData(obj: Record<string, unknown>, ...chaves: string[]): string | undefined {
  for (const chave of chaves) {
    const parsed = parseDataPje(obj[chave]);
    if (parsed) return parsed;
  }
  return undefined;
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
      const pesos: ConfigPeso = { ...CONFIG_PESO_PADRAO, ...(dto.pesos ?? {}) };
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

      // A distribuição vem antes do peso: as flags de etiqueta (dígito) entram no bloco D.
      const distribuicao = distribuirPorServidor(processos, mapa);

      // "Meta a um passo" = restantes por meta no acervo analisado (a base de
      // conclusos do gabinete ainda não entra nesta contagem).
      const metasRestantes = new Map<string, number>();
      for (const proc of processos) {
        for (const m of proc.metas) metasRestantes.set(m, (metasRestantes.get(m) ?? 0) + 1);
      }
      for (const proc of processos) this.aplicarAvaliacao(proc, metasRestantes, pesos);

      for (const [servidor, lista] of distribuicao.porServidor) {
        distribuicao.porServidor.set(servidor, ordenarPorPrioridade(lista));
      }
      distribuicao.naoAtribuidos = ordenarPorPrioridade(distribuicao.naoAtribuidos);

      const digitosPorServidor = new Map<string, number[]>();
      for (const [digito, servidor] of [...mapa.entries()].sort((a, b) => a[0] - b[0])) {
        digitosPorServidor.set(servidor, [...(digitosPorServidor.get(servidor) ?? []), digito]);
      }

      const { fileName } = await gerarSaidaDigito(distribuicao, digitosPorServidor, dto.formato, jobId, pesos);

      const resumo = this.montarResumo(distribuicao, digitosPorServidor, mapa, metasRestantes, pesos, processos);
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
    let primeiraLinhaLogada = false;

    for (const tarefa of tarefas) {
      if (this.isCancelled(jobId)) break;
      await listarProcessosDaTarefa(
        session, tarefa, false,
        (row) => {
          const numero = lerString(row, 'numeroProcesso');
          const idProcesso = typeof row['idProcesso'] === 'number' ? row['idProcesso'] : 0;
          if (!numero || !idProcesso) return;
          if (!primeiraLinhaLogada) {
            primeiraLinhaLogada = true;
            console.log(`[PLANILHA-DIGITO] Campos da linha do painel: ${Object.keys(row).join(', ')}`);
          }
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
            dataChegada: lerData(row, 'dataChegada'),
            ultimoMovimento: lerData(row, 'ultimoMovimento', 'dataUltimoMovimento'),
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
    pesos: ConfigPeso,
    onProgress: (feitos: number, atual: string) => void,
  ): Promise<ProcessoDigito[]> {
    const resultados: ProcessoDigito[] = new Array<ProcessoDigito>(registros.length);
    let feitos = 0;
    let nextIndex = 0;
    let viaListagem = 0;
    let viaEndpoint = 0;
    let semData = 0;
    let amostrasLogadas = 0;

    // Amostras da resposta crua ajudam a diagnosticar mudança de contrato no PJE.
    const logAmostra = (numero: string, info: string) => {
      if (amostrasLogadas < 3) {
        amostrasLogadas++;
        console.warn(`[PLANILHA-DIGITO] ultimoMovimento sem data para ${numero}: ${info}`);
      }
    };

    const worker = async (): Promise<void> => {
      while (true) {
        if (this.isCancelled(jobId)) return;
        const idx = nextIndex++;
        if (idx >= registros.length) return;
        const registro = registros[idx];

        // A listagem do painel já traz a última movimentação na maioria dos casos —
        // o endpoint por processo é só fallback.
        let dataMovimento = registro.ultimoMovimento;
        if (dataMovimento) {
          viaListagem++;
        } else {
          if (idx > 0) await sleep(STAGGER_MS);
          if (this.isCancelled(jobId)) return;
          try {
            const payload = await pjeApiGet<unknown>(session, `processos/${registro.idProcesso}/ultimoMovimento`);
            dataMovimento = extrairDataMovimento(payload);
            if (dataMovimento) {
              viaEndpoint++;
            } else {
              const amostra = typeof payload === 'string'
                ? `texto "${payload.slice(0, 200).replace(/\s+/g, ' ')}"`
                : `${typeof payload} ${JSON.stringify(payload)?.slice(0, 300)}`;
              logAmostra(registro.numeroProcesso, amostra);
            }
          } catch (err) {
            logAmostra(registro.numeroProcesso, `erro na requisicao: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (!dataMovimento) semData++;

        resultados[idx] = this.montarProcesso(registro, dataMovimento, agora, pesos);
        feitos++;
        onProgress(feitos, registro.numeroProcesso);
      }
    };

    await Promise.all(Array.from(
      { length: Math.min(ENRICH_CONCURRENCY, registros.length) },
      () => worker(),
    ));

    console.log(
      `[PLANILHA-DIGITO] Última movimentação: ${viaListagem} via listagem, `
      + `${viaEndpoint} via endpoint, ${semData} sem data (fallback dataChegada/sem dias).`,
    );

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
    pesos: ConfigPeso,
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

    // O peso, as flags de BI e a situação são aplicados depois da distribuição
    // (aplicarAvaliacao) — aqui só o registro base.
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
      metas: metasDoProcesso(registro.etiquetas, pesos),
      metaAUmPasso: false,
      situacao: 'TRABALHAVEL',
      bloqueado: false,
      prioridade: 'P4',
      pontuacao: 0,
      faixa: 'NORMAL',
      blocos: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 1 },
      flags,
      providencias: [],
    };
  }

  private aplicarAvaliacao(proc: ProcessoDigito, metasRestantes: Map<string, number>, config: ConfigPeso): void {
    const avaliacao = avaliarProcesso({
      metas: proc.metas,
      etiquetas: proc.etiquetas,
      assuntoPrincipal: proc.assuntoPrincipal,
      classeJudicial: proc.classeJudicial,
      diasParados: proc.diasParados,
      anoCnj: proc.anoCnj,
      tarefas: [proc.tarefaAtual, ...proc.outrasTarefas],
      flagsBase: proc.flags,
    }, metasRestantes, config);

    proc.pontuacao = avaliacao.peso;
    proc.faixa = avaliacao.faixa;
    proc.prioridade = avaliacao.prioridade;
    proc.situacao = avaliacao.situacao;
    proc.bloqueado = avaliacao.bloqueado;
    proc.metaAUmPasso = avaliacao.metaAUmPasso;
    proc.blocos = avaliacao.blocos;
    proc.flags = avaliacao.flags;
    proc.providencias = avaliacao.providencias;
  }

  private montarResumo(
    distribuicao: ReturnType<typeof distribuirPorServidor>,
    digitosPorServidor: Map<string, number[]>,
    mapa: Map<number, string>,
    metasRestantes: Map<string, number>,
    pesos: ConfigPeso,
    processos: ProcessoDigito[],
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
        if (proc.flags.includes(FLAGS.SEM_ETIQUETA_DIGITO)) semEtiquetaServidor++;
        if (proc.flags.includes(FLAGS.DIGITO_DIVERGENTE)) etiquetaDivergente++;
      }
    }

    const metasAUmPasso = [...metasRestantes.entries()]
      .filter(([, restantes]) => restantes <= pesos.limiarMetaAUmPasso)
      .map(([meta, restantes]) => ({
        meta,
        restantes,
        processos: processos
          .filter((p) => p.metas.includes(meta))
          .map((p) => p.numeroProcesso)
          .slice(0, 10),
      }));

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
      filasEspera: processos.filter((p) => p.situacao === 'FILA_ESPERA').length,
      metasAUmPasso,
      semEtiquetaServidor,
      etiquetaDivergente,
      malformados,
    };
  }
}
