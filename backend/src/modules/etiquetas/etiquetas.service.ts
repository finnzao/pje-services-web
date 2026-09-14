import { randomUUID } from 'node:crypto';
import { validatePjeSession, type PjeSession } from '../../shared/pje-api-client';
import { AppError } from '../../shared/errors';
import { resolveSessionFromDto, sessionStore } from '../pje-download/services/pje-auth';
import { getPersistedSession } from '../pje-download/services/pje-auth/session-store';
import {
  lerData, lerEtiquetas, lerString, listarNomesTarefasDoPainel, listarProcessosDaTarefa,
} from '../pje-download/services/download/painel-listing';
import { normalizarTexto } from '../pje-download/services/planilha-digito/digito-core';
import { configStore } from './config-store';
import { execucoesStore } from './execucoes-store';
import {
  contadorIgnoradosVazio, ehTarefaIgnorada, normalizarLista, planejarAcoes, type PlanoAcoes,
} from './etiquetas-core';
import {
  consultarDataUltimoMovimento, inserirEtiquetaNoProcesso, listarEtiquetasDoPerfil, removerEtiquetaDoProcesso,
} from './pje-etiquetas-client';
import type {
  EtapaExecucao, EtiquetasConfig, ExecucaoEtiquetas, ExecutarEtiquetasDTO, OrigemExecucao,
  ProcessoAcervo, ProcessoAfetado, SessaoOperadora, TotaisExecucao,
} from './types';

const ENRICH_CONCURRENCY = 4;
const ENRICH_STAGGER_MS = 250;
const APPLY_CONCURRENCY = 2;
const APPLY_STAGGER_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function totaisVazios(): TotaisExecucao {
  return {
    tarefasConsideradas: 0, tarefasIgnoradas: 0, processosListados: 0, candidatos: 0,
    inseridas: 0, removidas: 0, erros: 0, ignorados: contadorIgnoradosVazio(),
  };
}

/**
 * Executa a rotina de etiquetagem (agendada ou manual). Uma execução por vez: a
 * segunda chamada concorrente recebe 409. O andamento fica em execucoesStore para
 * polling pelo controller, no mesmo espírito do progressMap das planilhas.
 */
export class EtiquetasService {
  private execucaoAtualId: string | null = null;
  private cancelada = false;

  get emExecucao(): boolean { return this.execucaoAtualId !== null; }
  get execucaoAtual(): string | null { return this.execucaoAtualId; }

  cancelar(id: string): boolean {
    if (this.execucaoAtualId !== id) return false;
    this.cancelada = true;
    const exec = execucoesStore.get(id);
    if (exec && exec.status === 'running') {
      execucoesStore.upsert({ ...exec, mensagem: 'Cancelamento solicitado — interrompendo...' });
    }
    return true;
  }

  /** Inicia a execução em background e devolve o id imediatamente. */
  iniciar(origem: OrigemExecucao, dto: ExecutarEtiquetasDTO = {}): string {
    if (this.execucaoAtualId) {
      throw new AppError('EXECUCAO_EM_ANDAMENTO', `Já existe uma execução em andamento (${this.execucaoAtualId.slice(0, 8)}).`, 409);
    }
    const config = configStore.get();
    if (!config.etiqueta) {
      throw new AppError('ETIQUETA_NAO_CONFIGURADA', 'Configure a etiqueta a aplicar antes de executar a rotina.', 400);
    }

    const id = randomUUID();
    const exec: ExecucaoEtiquetas = {
      id, origem, dryRun: dto.dryRun === true, status: 'running', etapa: 'sessao', progresso: 0,
      mensagem: 'Resolvendo sessão PJE...', iniciadoEm: new Date().toISOString(),
      totais: totaisVazios(), processos: [],
      configSnapshot: {
        diasParado: config.diasParado, etiqueta: config.etiqueta, tarefasIgnoradas: config.tarefasIgnoradas,
        removerQuandoMovimentado: config.removerQuandoMovimentado, limitePorExecucao: config.limitePorExecucao,
      },
    };
    this.execucaoAtualId = id;
    this.cancelada = false;
    execucoesStore.upsert(exec);

    void this.executar(exec, config, dto)
      .catch((err) => console.error(`[ETIQUETAS] Execução ${id.slice(0, 8)} falhou:`, err instanceof Error ? err.message : err))
      .finally(() => { this.execucaoAtualId = null; this.cancelada = false; });
    return id;
  }

  // ───────────────────────── pipeline ─────────────────────────

  private async executar(exec: ExecucaoEtiquetas, config: EtiquetasConfig, dto: ExecutarEtiquetasDTO): Promise<void> {
    const emit = (patch: Partial<ExecucaoEtiquetas> & { etapa?: EtapaExecucao }) => {
      exec = { ...exec, ...patch };
      execucoesStore.upsert(exec);
    };
    const log = (msg: string) => console.log(`[ETIQUETAS] [${exec.id.slice(0, 8)}] ${msg}`);
    const etiqueta = config.etiqueta!;

    try {
      const session = await this.resolverSessao(config.sessao, dto);
      if (this.cancelada) return this.finalizarCancelada(emit);

      // A etiqueta configurada precisa continuar existindo no perfil da sessão. O endpoint
      // de inserir cria tags por nome — sem esta checagem um rename no PJE geraria uma tag nova.
      const disponiveis = await listarEtiquetasDoPerfil(session);
      const alvo = disponiveis.find((t) => t.id === etiqueta.id)
        ?? disponiveis.find((t) => normalizarTexto(t.nomeTag) === normalizarTexto(etiqueta.nome));
      if (!alvo) {
        throw new AppError('ETIQUETA_INEXISTENTE', `A etiqueta "${etiqueta.nome}" (id ${etiqueta.id}) não existe no perfil da sessão PJE.`, 422);
      }
      if (alvo.id !== etiqueta.id || alvo.nomeTag !== etiqueta.nome) {
        log(`Etiqueta configurada reconciliada com o PJE: ${etiqueta.nome}#${etiqueta.id} → ${alvo.nomeTag}#${alvo.id}`);
        configStore.patchInterno({ etiqueta: { id: alvo.id, nome: alvo.nomeTag } });
      }
      const nomeTag = alvo.nomeTag;
      const idTag = alvo.id;

      emit({ etapa: 'listando', progresso: 5, mensagem: 'Consultando tarefas do painel...' });
      const todasTarefas = await listarNomesTarefasDoPainel(session);
      const ignoradasNorm = normalizarLista(config.tarefasIgnoradas);
      const consideradas = todasTarefas.filter((t) => !ehTarefaIgnorada(t, ignoradasNorm));
      const ignoradas = todasTarefas.filter((t) => ehTarefaIgnorada(t, ignoradasNorm));
      exec.totais.tarefasConsideradas = consideradas.length;
      exec.totais.tarefasIgnoradas = ignoradas.length;
      log(`${todasTarefas.length} tarefas no painel: ${consideradas.length} consideradas, ${ignoradas.length} ignoradas`);

      // 1) Acervo das tarefas consideradas.
      const acervo = new Map<number, ProcessoAcervo>();
      let feitas = 0;
      for (const tarefa of consideradas) {
        if (this.cancelada) return this.finalizarCancelada(emit);
        await listarProcessosDaTarefa(session, tarefa, false, (row) => this.absorverLinha(acervo, row, tarefa), () => this.cancelada);
        feitas++;
        emit({ progresso: 5 + Math.round((feitas / Math.max(1, consideradas.length)) * 30), mensagem: `Listando processos: tarefa ${feitas}/${consideradas.length}...` });
      }

      // 2) Processos vinculados a tarefas ignoradas (um processo pode estar em mais de uma
      //    tarefa; se alguma delas for ignorada, ele fica de fora mesmo listado acima).
      const excluidos = new Set<number>();
      for (const tarefa of ignoradas) {
        if (this.cancelada) return this.finalizarCancelada(emit);
        await listarProcessosDaTarefa(session, tarefa, false, (row) => {
          const id = row['idProcesso'];
          if (typeof id === 'number') excluidos.add(id);
        }, () => this.cancelada);
      }
      exec.totais.processosListados = acervo.size;
      log(`${acervo.size} processos no acervo considerado; ${excluidos.size} vinculados a tarefas ignoradas`);

      // 3) Última movimentação: a listagem já traz na maioria; endpoint por processo é fallback.
      const registros = [...acervo.values()];
      const pendentes = registros.filter((r) => !r.dataUltimoMovimento);
      if (pendentes.length > 0) {
        emit({ etapa: 'enriquecendo', progresso: 40, mensagem: `Consultando última movimentação de ${pendentes.length} processos...` });
        await this.enriquecerUltimoMovimento(session, pendentes, (n) => {
          emit({ progresso: 40 + Math.round((n / pendentes.length) * 25), mensagem: `Última movimentação ${n}/${pendentes.length}...` });
        });
        if (this.cancelada) return this.finalizarCancelada(emit);
      }

      // 4) Plano.
      const plano = planejarAcoes(registros, {
        diasParado: config.diasParado, etiquetaNome: nomeTag, ignoradasNorm,
        removerQuandoMovimentado: config.removerQuandoMovimentado, excluidos, agora: new Date(),
      }, config.limitePorExecucao);
      exec.totais.ignorados = plano.ignorados;
      exec.totais.candidatos = plano.inserir.length + plano.remover.length;
      log(`Plano: ${plano.inserir.length} inserções, ${plano.remover.length} remoções; ignorados ${JSON.stringify(plano.ignorados)}`);

      // 5) Aplicação.
      emit({
        etapa: 'aplicando', progresso: 65,
        mensagem: exec.dryRun
          ? `Simulação: ${plano.inserir.length} inserções e ${plano.remover.length} remoções (nada será alterado no PJE).`
          : `Aplicando etiqueta "${nomeTag}" em ${plano.inserir.length} processos...`,
      });
      await this.aplicarPlano(session, plano, nomeTag, idTag, exec, (afetados) => {
        const total = plano.inserir.length + plano.remover.length;
        emit({ progresso: 65 + Math.round((afetados / Math.max(1, total)) * 33), mensagem: `Aplicando ${afetados}/${total}...` });
      });
      if (this.cancelada) return this.finalizarCancelada(emit);

      const t = exec.totais;
      emit({
        status: 'completed', etapa: 'concluido', progresso: 100, finalizadoEm: new Date().toISOString(),
        mensagem: exec.dryRun
          ? `Simulação concluída: ${plano.inserir.length} processos seriam etiquetados, ${plano.remover.length} teriam a etiqueta removida.`
          : `Concluído: ${t.inseridas} etiquetadas, ${t.removidas} removidas, ${t.erros} erro(s).`,
      });
      log(exec.mensagem);
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      emit({ status: 'failed', progresso: exec.progresso, finalizadoEm: new Date().toISOString(), erro: mensagem, mensagem: `Falha: ${mensagem}` });
      throw err;
    }
  }

  private finalizarCancelada(emit: (p: Partial<ExecucaoEtiquetas>) => void): void {
    emit({ status: 'cancelled', finalizadoEm: new Date().toISOString(), mensagem: 'Execução cancelada.' });
  }

  private absorverLinha(acervo: Map<number, ProcessoAcervo>, row: Record<string, unknown>, tarefa: string): void {
    const idProcesso = typeof row['idProcesso'] === 'number' ? row['idProcesso'] : 0;
    const numero = lerString(row, 'numeroProcesso');
    if (!idProcesso || !numero) return;
    const existente = acervo.get(idProcesso);
    if (existente) {
      if (existente.tarefaAtual !== tarefa && !existente.outrasTarefas.includes(tarefa)) existente.outrasTarefas.push(tarefa);
      return;
    }
    acervo.set(idProcesso, {
      idProcesso,
      numeroProcesso: numero,
      tarefaAtual: lerString(row, 'nomeTarefa') ?? tarefa,
      outrasTarefas: [],
      etiquetas: lerEtiquetas(row),
      dataChegada: lerData(row, 'dataChegada'),
      dataUltimoMovimento: lerData(row, 'ultimoMovimento', 'dataUltimoMovimento'),
    });
  }

  private async enriquecerUltimoMovimento(session: PjeSession, pendentes: ProcessoAcervo[], onProgress: (n: number) => void): Promise<void> {
    let next = 0;
    let feitos = 0;
    const worker = async () => {
      while (!this.cancelada) {
        const idx = next++;
        if (idx >= pendentes.length) return;
        if (idx > 0) await sleep(ENRICH_STAGGER_MS);
        const p = pendentes[idx];
        try {
          p.dataUltimoMovimento = await consultarDataUltimoMovimento(session, p.idProcesso);
        } catch (err) {
          console.warn(`[ETIQUETAS] ultimoMovimento falhou para ${p.numeroProcesso}: ${err instanceof Error ? err.message : err}`);
        }
        onProgress(++feitos);
      }
    };
    await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, pendentes.length) }, worker));
  }

  private async aplicarPlano(
    session: PjeSession, plano: PlanoAcoes, nomeTag: string, idTag: number,
    exec: ExecucaoEtiquetas, onProgress: (n: number) => void,
  ): Promise<void> {
    type Item = { proc: ProcessoAcervo; diasParados: number; tipo: 'inserir' | 'remover' };
    const fila: Item[] = [
      ...plano.inserir.map((i) => ({ ...i, tipo: 'inserir' as const })),
      ...plano.remover.map((i) => ({ ...i, tipo: 'remover' as const })),
    ];
    let next = 0;
    let feitos = 0;

    const registrar = (item: Item, acao: ProcessoAfetado['acao'], erro?: string) => {
      exec.processos.push({
        idProcesso: item.proc.idProcesso, numeroProcesso: item.proc.numeroProcesso,
        tarefa: item.proc.tarefaAtual, diasParados: item.diasParados,
        dataUltimoMovimento: item.proc.dataUltimoMovimento, acao, erro,
      });
      if (acao === 'inserida') exec.totais.inseridas++;
      else if (acao === 'removida') exec.totais.removidas++;
      else if (acao === 'erro') exec.totais.erros++;
      onProgress(++feitos);
    };

    if (exec.dryRun) {
      for (const item of fila) registrar(item, item.tipo === 'inserir' ? 'simulada_insercao' : 'simulada_remocao');
      return;
    }

    const worker = async () => {
      while (!this.cancelada) {
        const idx = next++;
        if (idx >= fila.length) return;
        if (idx > 0) await sleep(APPLY_STAGGER_MS);
        const item = fila[idx];
        try {
          if (item.tipo === 'inserir') {
            await inserirEtiquetaNoProcesso(session, nomeTag, item.proc.idProcesso);
            registrar(item, 'inserida');
          } else {
            await removerEtiquetaDoProcesso(session, idTag, item.proc.idProcesso);
            registrar(item, 'removida');
          }
        } catch (err) {
          registrar(item, 'erro', err instanceof Error ? err.message : String(err));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(APPLY_CONCURRENCY, fila.length) }, worker));
  }

  // ───────────────────────── sessão ─────────────────────────

  /**
   * Ordem: sessão/credenciais da própria chamada (execução manual) → pjeSessionId
   * vinculado na configuração → sessão persistida por CPF (4 h) → credenciais de
   * ambiente (ETIQUETAS_PJE_CPF/SENHA; falha se o usuário tiver 2FA).
   */
  async resolverSessao(sessao: SessaoOperadora, dto: ExecutarEtiquetasDTO = {}): Promise<PjeSession> {
    const tentativas: string[] = [];

    if (dto.pjeSessionId || dto.credentials) {
      const s = await resolveSessionFromDto(dto).catch((err: Error) => { tentativas.push(`chamada: ${err.message}`); return null; });
      if (s && await validatePjeSession(s)) return s;
      if (s) tentativas.push('chamada: sessão inválida no PJE');
    }

    if (sessao.pjeSessionId) {
      const s = sessionStore.get(sessao.pjeSessionId) as unknown as PjeSession | undefined;
      if (s && await validatePjeSession(s)) return s;
      tentativas.push(s ? 'sessão vinculada inválida no PJE' : 'sessão vinculada expirou');
    }

    if (sessao.cpf) {
      const p = getPersistedSession(sessao.cpf);
      if (p) {
        const s: PjeSession = { cookies: p.cookies, idUsuarioLocalizacao: p.idUsuarioLocalizacao, idUsuario: p.idUsuario };
        if (await validatePjeSession(s)) return s;
      }
      tentativas.push(p ? 'sessão persistida do CPF inválida no PJE' : 'sem sessão persistida para o CPF');
    }

    const envCpf = process.env.ETIQUETAS_PJE_CPF?.replace(/\D/g, '');
    const envSenha = process.env.ETIQUETAS_PJE_SENHA;
    if (envCpf && envSenha) {
      const perfil = sessao.pjeProfileIndex ?? (process.env.ETIQUETAS_PJE_PERFIL ? Number(process.env.ETIQUETAS_PJE_PERFIL) : undefined);
      try {
        const s = await resolveSessionFromDto({ credentials: { cpf: envCpf, password: envSenha }, pjeProfileIndex: perfil });
        if (await validatePjeSession(s)) return s;
        tentativas.push('login por ambiente: sessão inválida');
      } catch (err) {
        tentativas.push(`login por ambiente: ${err instanceof Error ? err.message : err}`);
      }
    }

    throw new AppError(
      'SESSAO_PJE_INDISPONIVEL',
      `Nenhuma sessão PJE válida para executar a rotina (${tentativas.join('; ') || 'nenhuma sessão configurada'}). Vincule uma sessão ativa em /config.`,
      401,
    );
  }

  /** Verificação leve usada pelo status do agendador (sem login). */
  async sessaoConfiguradaValida(sessao: SessaoOperadora): Promise<boolean | null> {
    if (sessao.pjeSessionId) {
      const s = sessionStore.get(sessao.pjeSessionId) as unknown as PjeSession | undefined;
      if (s) return validatePjeSession(s);
    }
    if (sessao.cpf) {
      const p = getPersistedSession(sessao.cpf);
      if (p) return validatePjeSession({ cookies: p.cookies, idUsuarioLocalizacao: p.idUsuarioLocalizacao });
    }
    return sessao.pjeSessionId || sessao.cpf ? false : null;
  }
}
