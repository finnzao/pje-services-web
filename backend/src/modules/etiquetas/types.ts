/**
 * Tipos do serviço "Etiquetas": rotina automática que aplica uma etiqueta do PJE
 * em processos parados há mais de N dias (por data da última movimentação),
 * respeitando uma lista de tarefas ignoradas.
 */

export interface EtiquetaRef {
  /** id da tag no PJE (painelUsuario/etiquetas → entities[].id). */
  id: number;
  /** nomeTag — é o que o endpoint processoTags/inserir recebe. */
  nome: string;
}

export interface SessaoOperadora {
  /** Sessão ativa do sessionStore vinculada pelo usuário na tela de configuração. */
  pjeSessionId?: string;
  /** CPF cuja sessão persistida (4 h) serve de fallback quando o pjeSessionId expira. */
  cpf?: string;
  /** Perfil a selecionar quando o login for feito por credenciais (env). */
  pjeProfileIndex?: number;
}

export interface EtiquetasConfig {
  /** Liga/desliga a rotina agendada. A execução manual funciona independente disto. */
  ativo: boolean;
  /** Processos parados há MAIS de N dias são etiquetados. Padrão 120. */
  diasParado: number;
  /** Etiqueta (já existente no PJE) a aplicar. */
  etiqueta: EtiquetaRef | null;
  /** Blacklist: processos vinculados a estas tarefas nunca são etiquetados. */
  tarefasIgnoradas: string[];
  /** Horário diário da rotina, "HH:mm" (hora local do servidor). */
  horaExecucao: string;
  /**
   * Quando true, a etiqueta é removida de processos que voltaram a movimentar
   * (dias parados ≤ diasParado). Padrão false — a rotina só insere.
   */
  removerQuandoMovimentado: boolean;
  /** Teto de inserções + remoções por execução (proteção contra lote errado). */
  limitePorExecucao: number;
  sessao: SessaoOperadora;
  atualizadoEm: string;
  atualizadoPor?: string;
}

export type OrigemExecucao = 'agendada' | 'manual';
export type StatusExecucao = 'running' | 'completed' | 'failed' | 'cancelled';
export type EtapaExecucao = 'sessao' | 'listando' | 'enriquecendo' | 'aplicando' | 'concluido';

export type AcaoProcesso = 'inserida' | 'removida' | 'simulada_insercao' | 'simulada_remocao' | 'erro';

export interface ProcessoAfetado {
  idProcesso: number;
  numeroProcesso: string;
  tarefa: string;
  diasParados: number | null;
  dataUltimoMovimento?: string;
  acao: AcaoProcesso;
  erro?: string;
}

export type MotivoIgnorado =
  | 'TAREFA_IGNORADA'
  | 'SEM_DATA_MOVIMENTO'
  | 'DENTRO_DO_PRAZO'
  | 'JA_ETIQUETADO'
  | 'LIMITE_EXECUCAO';

export interface TotaisExecucao {
  tarefasConsideradas: number;
  tarefasIgnoradas: number;
  processosListados: number;
  candidatos: number;
  inseridas: number;
  removidas: number;
  erros: number;
  ignorados: Record<MotivoIgnorado, number>;
}

export interface ExecucaoEtiquetas {
  id: string;
  origem: OrigemExecucao;
  dryRun: boolean;
  status: StatusExecucao;
  etapa: EtapaExecucao;
  /** 0–100 */
  progresso: number;
  mensagem: string;
  iniciadoEm: string;
  finalizadoEm?: string;
  totais: TotaisExecucao;
  /** Processos em que houve (ou haveria, em dry-run) ação. */
  processos: ProcessoAfetado[];
  /** Parâmetros vigentes no momento da execução, para auditoria. */
  configSnapshot: Pick<EtiquetasConfig, 'diasParado' | 'etiqueta' | 'tarefasIgnoradas' | 'removerQuandoMovimentado' | 'limitePorExecucao'>;
  erro?: string;
}

/** Resumo da execução para listagens (sem a lista de processos). */
export type ExecucaoResumo = Omit<ExecucaoEtiquetas, 'processos'>;

/** Corpo aceito por POST /executar. */
export interface ExecutarEtiquetasDTO {
  /** Só planeja e reporta; não chama inserir/remover no PJE. */
  dryRun?: boolean;
  /** Sessão/credenciais desta chamada — têm precedência sobre a sessão configurada. */
  pjeSessionId?: string;
  credentials?: { cpf: string; password: string };
  pjeProfileIndex?: number;
}

export interface StatusAgendador {
  ativo: boolean;
  horaExecucao: string;
  proximaExecucao: string | null;
  emExecucao: boolean;
  execucaoAtualId: string | null;
  ultimaExecucao: ExecucaoResumo | null;
  sessaoVinculada: boolean;
  sessaoValida: boolean | null;
}

/** Tag do PJE como devolvida por painelUsuario/etiquetas. */
export interface EtiquetaPje {
  id: number;
  nomeTag: string;
  nomeTagCompleto: string;
  favorita: boolean;
}

/** Processo do acervo do painel já normalizado para as regras. */
export interface ProcessoAcervo {
  idProcesso: number;
  numeroProcesso: string;
  tarefaAtual: string;
  outrasTarefas: string[];
  etiquetas: string[];
  dataChegada?: string;
  dataUltimoMovimento?: string;
}
