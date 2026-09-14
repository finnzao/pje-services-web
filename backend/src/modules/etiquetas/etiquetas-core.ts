/**
 * Regras puras do serviço de etiquetas (sem I/O) — cobertas por __tests__/etiquetas-core.test.ts.
 */
import { calcularDiasParados, normalizarTexto } from '../pje-download/services/planilha-digito/digito-core';
import type { EtiquetasConfig, MotivoIgnorado, ProcessoAcervo } from './types';

export const DIAS_PARADO_PADRAO = 120;
export const HORA_EXECUCAO_PADRAO = '03:00';
export const LIMITE_POR_EXECUCAO_PADRAO = 500;
const LIMITE_MAXIMO = 5000;
const DIAS_MAXIMO = 3650;

export const CONFIG_PADRAO: EtiquetasConfig = {
  ativo: false,
  diasParado: DIAS_PARADO_PADRAO,
  etiqueta: null,
  tarefasIgnoradas: [],
  horaExecucao: HORA_EXECUCAO_PADRAO,
  removerQuandoMovimentado: false,
  limitePorExecucao: LIMITE_POR_EXECUCAO_PADRAO,
  sessao: {},
  atualizadoEm: new Date(0).toISOString(),
};

// ───────────────────────── Configuração ─────────────────────────

export interface ResultadoValidacao {
  config?: EtiquetasConfig;
  erros: string[];
}

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Aplica um patch parcial (corpo de PUT /config) sobre a configuração atual,
 * validando campo a campo. Campos ausentes mantêm o valor atual.
 */
export function validarConfig(patch: unknown, atual: EtiquetasConfig): ResultadoValidacao {
  const erros: string[] = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { erros: ['Corpo da requisição deve ser um objeto.'] };
  }
  const p = patch as Record<string, unknown>;
  const cfg: EtiquetasConfig = { ...atual, sessao: { ...atual.sessao }, tarefasIgnoradas: [...atual.tarefasIgnoradas] };

  if ('ativo' in p) {
    if (typeof p.ativo !== 'boolean') erros.push('ativo deve ser booleano.');
    else cfg.ativo = p.ativo;
  }
  if ('diasParado' in p) {
    const n = Number(p.diasParado);
    if (!Number.isInteger(n) || n < 1 || n > DIAS_MAXIMO) erros.push(`diasParado deve ser inteiro entre 1 e ${DIAS_MAXIMO}.`);
    else cfg.diasParado = n;
  }
  if ('etiqueta' in p) {
    if (p.etiqueta === null) cfg.etiqueta = null;
    else {
      const e = p.etiqueta as Record<string, unknown> | undefined;
      const id = Number(e?.id);
      const nome = typeof e?.nome === 'string' ? e.nome.trim() : '';
      if (!e || !Number.isInteger(id) || id <= 0 || !nome) erros.push('etiqueta deve ter id numérico e nome.');
      else cfg.etiqueta = { id, nome };
    }
  }
  if ('tarefasIgnoradas' in p) {
    if (!Array.isArray(p.tarefasIgnoradas) || !p.tarefasIgnoradas.every((t) => typeof t === 'string')) {
      erros.push('tarefasIgnoradas deve ser uma lista de nomes de tarefa.');
    } else {
      cfg.tarefasIgnoradas = dedupTarefas(p.tarefasIgnoradas as string[]);
    }
  }
  if ('horaExecucao' in p) {
    if (typeof p.horaExecucao !== 'string' || !HORA_RE.test(p.horaExecucao)) erros.push('horaExecucao deve estar no formato HH:mm.');
    else cfg.horaExecucao = p.horaExecucao;
  }
  if ('removerQuandoMovimentado' in p) {
    if (typeof p.removerQuandoMovimentado !== 'boolean') erros.push('removerQuandoMovimentado deve ser booleano.');
    else cfg.removerQuandoMovimentado = p.removerQuandoMovimentado;
  }
  if ('limitePorExecucao' in p) {
    const n = Number(p.limitePorExecucao);
    if (!Number.isInteger(n) || n < 1 || n > LIMITE_MAXIMO) erros.push(`limitePorExecucao deve ser inteiro entre 1 e ${LIMITE_MAXIMO}.`);
    else cfg.limitePorExecucao = n;
  }
  if ('sessao' in p) {
    if (p.sessao === null) cfg.sessao = {};
    else if (typeof p.sessao !== 'object' || Array.isArray(p.sessao)) erros.push('sessao deve ser um objeto.');
    else {
      const s = p.sessao as Record<string, unknown>;
      const sessao = { ...cfg.sessao };
      if ('pjeSessionId' in s) {
        if (s.pjeSessionId === null || s.pjeSessionId === '') delete sessao.pjeSessionId;
        else if (typeof s.pjeSessionId !== 'string') erros.push('sessao.pjeSessionId deve ser string.');
        else sessao.pjeSessionId = s.pjeSessionId;
      }
      if ('cpf' in s) {
        if (s.cpf === null || s.cpf === '') delete sessao.cpf;
        else if (typeof s.cpf !== 'string' || !/^\d{11}$/.test(s.cpf.replace(/\D/g, ''))) erros.push('sessao.cpf deve ter 11 dígitos.');
        else sessao.cpf = s.cpf.replace(/\D/g, '');
      }
      if ('pjeProfileIndex' in s) {
        if (s.pjeProfileIndex === null) delete sessao.pjeProfileIndex;
        else if (!Number.isInteger(Number(s.pjeProfileIndex))) erros.push('sessao.pjeProfileIndex deve ser inteiro.');
        else sessao.pjeProfileIndex = Number(s.pjeProfileIndex);
      }
      cfg.sessao = sessao;
    }
  }

  // Ligar a rotina exige que ela tenha o que aplicar.
  if (cfg.ativo && !cfg.etiqueta) erros.push('Não é possível ativar a rotina sem uma etiqueta configurada.');

  if (erros.length > 0) return { erros };
  return { config: cfg, erros: [] };
}

/** Remove duplicatas (ignorando acento/caixa) e entradas vazias, preservando a primeira grafia. */
export function dedupTarefas(tarefas: string[]): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const t of tarefas) {
    const norm = normalizarTexto(t);
    if (!norm || vistas.has(norm)) continue;
    vistas.add(norm);
    out.push(t.trim());
  }
  return out;
}

// ───────────────────────── Regras de etiquetagem ─────────────────────────

export function ehTarefaIgnorada(tarefa: string, ignoradasNorm: Set<string>): boolean {
  return ignoradasNorm.has(normalizarTexto(tarefa));
}

export function normalizarLista(itens: string[]): Set<string> {
  return new Set(itens.map(normalizarTexto).filter(Boolean));
}

export function possuiEtiqueta(etiquetas: string[], nome: string): boolean {
  const alvo = normalizarTexto(nome);
  return etiquetas.some((e) => normalizarTexto(e) === alvo);
}

export type Decisao =
  | { acao: 'INSERIR'; diasParados: number }
  | { acao: 'REMOVER'; diasParados: number }
  | { acao: 'IGNORAR'; motivo: MotivoIgnorado; diasParados: number | null };

export interface ContextoDecisao {
  diasParado: number;
  etiquetaNome: string;
  ignoradasNorm: Set<string>;
  removerQuandoMovimentado: boolean;
  /** ids vinculados a alguma tarefa ignorada (listados separadamente). */
  excluidos: Set<number>;
  agora: Date;
}

/**
 * Decide o que fazer com um processo do acervo.
 *
 * Ordem das regras:
 *  1. Vínculo com tarefa ignorada (atual, outras ou lista externa) → nunca etiqueta.
 *  2. Sem data de última movimentação → não decide (não usa dataChegada: a regra é
 *     explicitamente pela última movimentação; um chute conservador etiquetaria errado).
 *  3. Parado há MAIS de diasParado → insere, salvo se já tem a etiqueta.
 *  4. Dentro do prazo → remove a etiqueta se removerQuandoMovimentado, senão ignora.
 */
export function decidirProcesso(proc: ProcessoAcervo, ctx: ContextoDecisao): Decisao {
  const diasParados = calcularDiasParados(proc.dataUltimoMovimento, ctx.agora);

  const vinculadoAIgnorada = ctx.excluidos.has(proc.idProcesso)
    || ehTarefaIgnorada(proc.tarefaAtual, ctx.ignoradasNorm)
    || proc.outrasTarefas.some((t) => ehTarefaIgnorada(t, ctx.ignoradasNorm));
  if (vinculadoAIgnorada) return { acao: 'IGNORAR', motivo: 'TAREFA_IGNORADA', diasParados };

  if (diasParados === null) return { acao: 'IGNORAR', motivo: 'SEM_DATA_MOVIMENTO', diasParados };

  const jaTem = possuiEtiqueta(proc.etiquetas, ctx.etiquetaNome);
  if (diasParados > ctx.diasParado) {
    return jaTem
      ? { acao: 'IGNORAR', motivo: 'JA_ETIQUETADO', diasParados }
      : { acao: 'INSERIR', diasParados };
  }
  if (jaTem && ctx.removerQuandoMovimentado) return { acao: 'REMOVER', diasParados };
  return { acao: 'IGNORAR', motivo: 'DENTRO_DO_PRAZO', diasParados };
}

export interface PlanoAcoes {
  inserir: Array<{ proc: ProcessoAcervo; diasParados: number }>;
  remover: Array<{ proc: ProcessoAcervo; diasParados: number }>;
  ignorados: Record<MotivoIgnorado, number>;
}

export function contadorIgnoradosVazio(): Record<MotivoIgnorado, number> {
  return { TAREFA_IGNORADA: 0, SEM_DATA_MOVIMENTO: 0, DENTRO_DO_PRAZO: 0, JA_ETIQUETADO: 0, LIMITE_EXECUCAO: 0 };
}

/**
 * Monta o plano de ações para o acervo. Inserções vêm ordenadas do mais parado para o
 * menos parado, para que o teto por execução atinja primeiro os casos mais graves.
 */
export function planejarAcoes(processos: ProcessoAcervo[], ctx: ContextoDecisao, limite: number): PlanoAcoes {
  const plano: PlanoAcoes = { inserir: [], remover: [], ignorados: contadorIgnoradosVazio() };
  for (const proc of processos) {
    const d = decidirProcesso(proc, ctx);
    if (d.acao === 'INSERIR') plano.inserir.push({ proc, diasParados: d.diasParados });
    else if (d.acao === 'REMOVER') plano.remover.push({ proc, diasParados: d.diasParados });
    else plano.ignorados[d.motivo]++;
  }
  plano.inserir.sort((a, b) => b.diasParados - a.diasParados);
  plano.remover.sort((a, b) => a.diasParados - b.diasParados);

  const total = plano.inserir.length + plano.remover.length;
  if (total > limite) {
    plano.ignorados.LIMITE_EXECUCAO = total - limite;
    const sobraParaRemover = Math.max(0, limite - plano.inserir.length);
    plano.inserir = plano.inserir.slice(0, limite);
    plano.remover = plano.remover.slice(0, sobraParaRemover);
  }
  return plano;
}

// ───────────────────────── Agendamento ─────────────────────────

/** Próximo instante em que "HH:mm" ocorre a partir de `agora` (hoje, se ainda não passou). */
export function proximaOcorrencia(horaExecucao: string, agora: Date): Date {
  const m = HORA_RE.exec(horaExecucao);
  const [hh, mm] = m ? [Number(m[1]), Number(m[2])] : [3, 0];
  const alvo = new Date(agora);
  alvo.setHours(hh, mm, 0, 0);
  if (alvo.getTime() <= agora.getTime()) alvo.setDate(alvo.getDate() + 1);
  return alvo;
}

/**
 * A rotina deve disparar quando o horário do dia já passou e ainda não houve execução
 * agendada hoje. Tolerante a ticks perdidos (o serviço dormiu/reiniciou): dispara no
 * primeiro tick após o horário, não só no minuto exato.
 */
export function deveExecutarAgora(horaExecucao: string, agora: Date, ultimaAgendadaEm?: string): boolean {
  const m = HORA_RE.exec(horaExecucao);
  if (!m) return false;
  const alvoHoje = new Date(agora);
  alvoHoje.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (agora.getTime() < alvoHoje.getTime()) return false;
  if (!ultimaAgendadaEm) return true;
  const ultima = new Date(ultimaAgendadaEm);
  if (Number.isNaN(ultima.getTime())) return true;
  return ultima.getTime() < alvoHoje.getTime();
}
