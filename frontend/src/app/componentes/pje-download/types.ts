export type EtapaWizard = 'login' | '2fa' | 'perfil' | 'download' | 'historico';
export type PJEDownloadMode = 'by_task' | 'by_tag' | 'by_number' | 'by_search';
export type ServicoAtivo = 'processos' | 'advogados' | 'pesquisa';

export interface EstadoExecucao {
  isDownloading: boolean; downloadProgress: number; currentProcess: string;
  totalProcesses: number; completedProcesses: number; failedProcesses: number;
  notAvailableCount: number;
  downloadStatus: 'idle' | 'listing' | 'downloading' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
  downloadMessage: string; bytesDownloaded: number;
}

export const ESTADO_EXECUCAO_INICIAL: EstadoExecucao = {
  isDownloading: false, downloadProgress: 0, currentProcess: '', totalProcesses: 0,
  completedProcesses: 0, failedProcesses: 0, notAvailableCount: 0,
  downloadStatus: 'idle', downloadMessage: '', bytesDownloaded: 0,
};

export interface UsuarioPJE { idUsuario: number; nomeUsuario: string; login: string; perfil: string; nomePerfil: string; idUsuarioLocalizacaoMagistradoServidor: number; }
export interface PerfilPJE { indice: number; nome: string; orgao: string; favorito: boolean; }
export interface TarefaPJE { id: number; nome: string; quantidadePendente: number; }
export interface EtiquetaPJE { id: number; nomeTag: string; nomeTagCompleto: string; favorita: boolean; }

export interface SessaoPJE {
  autenticado: boolean; sessionId?: string; usuario?: UsuarioPJE; perfis?: PerfilPJE[];
  perfilSelecionado?: PerfilPJE; tarefas?: TarefaPJE[]; tarefasFavoritas?: TarefaPJE[]; etiquetas?: EtiquetaPJE[];
  twoFactorType?: 'totp' | 'email';
}

export interface SearchCriteria {
  nomeParte?: string;
  outrosNomes?: string;
  nomeAdvogado?: string;
  numeroSequencial?: string;
  numeroDigito?: string;
  numeroAno?: string;
  numeroTribunal?: string;
  numeroOrgao?: string;
  documentoParte?: string;
  assunto?: string;
  classeJudicial?: string;
  numeroDocumento?: string;
  numeroOAB?: string;
  letraOAB?: string;
  ufOAB?: string;
  jurisdicao?: string;
  orgaoJulgador?: string;
  dataAutuacaoInicio?: string;
  dataAutuacaoFim?: string;
  valorCausaInicial?: string;
  valorCausaFinal?: string;
}

export interface ComboOption { value: string; label: string; }

export interface SearchFormOptions {
  ufOab: ComboOption[];
  jurisdicoes: ComboOption[];
  orgaosJulgadores: ComboOption[];
}

export interface SearchResultRow {
  numeroProcesso: string;
  orgaoJulgador: string;
  autuadoEm: string;
  classeJudicial: string;
  poloAtivo: string;
  poloPassivo: string;
  noAtual: string;
  ultimaMovimentacao: string;
}

export interface EntradaLog { id: number; timestamp: string; nivel: 'info' | 'warn' | 'error' | 'success'; modulo: string; mensagem: string; dados?: unknown; }

export interface FiltroAdvogado { tipo: 'nome' | 'oab'; valor: string; }

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function safeStr(val: string | undefined | null): string { return val ?? ''; }

export const logger = {
  info: (modulo: string, msg: string, dados?: unknown) => console.log(`[${modulo}] ${msg}`, dados ?? ''),
  warn: (modulo: string, msg: string, dados?: unknown) => console.warn(`[${modulo}] ${msg}`, dados ?? ''),
  error: (modulo: string, msg: string, dados?: unknown) => console.error(`[${modulo}] ${msg}`, dados ?? ''),
  success: (modulo: string, msg: string, dados?: unknown) => console.log(`[${modulo}] ✓ ${msg}`, dados ?? ''),
};
