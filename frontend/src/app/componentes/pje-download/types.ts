/* eslint-disable @typescript-eslint/no-explicit-any */

// Single source of truth: tipos, constantes e helpers do módulo PJE Download

export type EtapaWizard = 'login' | '2fa' | 'perfil' | 'download' | 'historico';
export type PJEDownloadMode = 'by_number' | 'by_task' | 'by_tag';
export type ServicoAtivo = 'processos' | 'advogados';

export type PJEJobStatus =
  | 'pending' | 'authenticating' | 'awaiting_2fa'
  | 'selecting_profile' | 'processing' | 'downloading'
  | 'checking_integrity' | 'retrying'
  | 'completed' | 'partial' | 'failed' | 'cancelled';

// ── Variáveis de estado da execução ──────────────────────
// Usadas para exibir progresso em tempo real ao usuário
export interface EstadoExecucao {
  isDownloading: boolean;
  downloadProgress: number;
  currentProcess: string;
  totalProcesses: number;
  completedProcesses: number;
  failedProcesses: number;
  downloadStatus: 'idle' | 'listing' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  downloadMessage: string;
  bytesDownloaded: number;
}

export const ESTADO_EXECUCAO_INICIAL: EstadoExecucao = {
  isDownloading: false,
  downloadProgress: 0,
  currentProcess: '',
  totalProcesses: 0,
  completedProcesses: 0,
  failedProcesses: 0,
  downloadStatus: 'idle',
  downloadMessage: '',
  bytesDownloaded: 0,
};

// ── Interfaces ───────────────────────────────────────────

export interface UsuarioPJE {
  idUsuario: number;
  nomeUsuario: string;
  login: string;
  perfil: string;
  nomePerfil: string;
  idUsuarioLocalizacaoMagistradoServidor: number;
}

export interface PerfilPJE {
  indice: number;
  nome: string;
  orgao: string;
  favorito: boolean;
}

export interface TarefaPJE {
  id: number;
  nome: string;
  quantidadePendente: number;
}

export interface EtiquetaPJE {
  id: number;
  nomeTag: string;
  nomeTagCompleto: string;
  favorita: boolean;
}

export interface SessaoPJE {
  autenticado: boolean;
  sessionId?: string;
  usuario?: UsuarioPJE;
  perfis?: PerfilPJE[];
  perfilSelecionado?: PerfilPJE;
  tarefas?: TarefaPJE[];
  tarefasFavoritas?: TarefaPJE[];
  etiquetas?: EtiquetaPJE[];
}

export interface ParametrosDownload {
  mode: PJEDownloadMode;
  taskName?: string;
  isFavorite?: boolean;
  tagId?: number;
  tagName?: string;
  processNumbers?: string[];
  documentType?: number;
  pjeProfileIndex?: number;
}

export interface PJEDownloadedFile {
  processNumber: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  downloadedAt: string;
}

export interface PJEDownloadError {
  processNumber?: string;
  message: string;
  code?: string;
  timestamp: string;
}

export interface DownloadJobResponse {
  id: string;
  userId: number;
  mode: PJEDownloadMode;
  status: PJEJobStatus;
  progress: number;
  totalProcesses: number;
  successCount: number;
  failureCount: number;
  files: PJEDownloadedFile[];
  errors: PJEDownloadError[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PJEDownloadProgress {
  jobId: string;
  status: PJEJobStatus;
  progress: number;
  totalProcesses: number;
  successCount: number;
  failureCount: number;
  currentProcess?: string;
  files: PJEDownloadedFile[];
  errors: PJEDownloadError[];
  message: string;
  timestamp: number;
}

export interface EntradaLog {
  id: number;
  timestamp: string;
  nivel: 'info' | 'warn' | 'error' | 'success';
  modulo: string;
  mensagem: string;
  dados?: unknown;
}

// ── Constantes ───────────────────────────────────────────

interface StatusConfig { label: string; color: string; bg: string }

export const STATUS_CONFIG: Record<PJEJobStatus, StatusConfig> = {
  pending:            { label: 'Na fila',              color: 'text-slate-600',   bg: 'bg-slate-100' },
  authenticating:     { label: 'Autenticando',         color: 'text-blue-700',    bg: 'bg-blue-50' },
  awaiting_2fa:       { label: 'Aguardando 2FA',       color: 'text-amber-700',   bg: 'bg-amber-50' },
  selecting_profile:  { label: 'Selecionando perfil',  color: 'text-blue-700',    bg: 'bg-blue-50' },
  processing:         { label: 'Processando',          color: 'text-blue-700',    bg: 'bg-blue-50' },
  downloading:        { label: 'Baixando',             color: 'text-indigo-700',  bg: 'bg-indigo-50' },
  checking_integrity: { label: 'Verificando',          color: 'text-purple-700',  bg: 'bg-purple-50' },
  retrying:           { label: 'Retentando',           color: 'text-orange-700',  bg: 'bg-orange-50' },
  completed:          { label: 'Concluído',            color: 'text-emerald-700', bg: 'bg-emerald-50' },
  failed:             { label: 'Falhou',               color: 'text-red-700',     bg: 'bg-red-50' },
  cancelled:          { label: 'Cancelado',            color: 'text-slate-500',   bg: 'bg-slate-100' },
  partial:            { label: 'Parcial',              color: 'text-amber-700',   bg: 'bg-amber-50' },
};

export const MODE_CONFIG: Record<PJEDownloadMode, { label: string; description: string }> = {
  by_task:   { label: 'Por Tarefa',   description: 'Baixar processos de uma tarefa' },
  by_tag:    { label: 'Por Etiqueta', description: 'Baixar por etiqueta/marcador' },
  by_number: { label: 'Por Número',   description: 'Informar números CNJ' },
};

const ACTIVE_STATUSES: PJEJobStatus[] = [
  'pending', 'authenticating', 'awaiting_2fa', 'selecting_profile',
  'processing', 'downloading', 'checking_integrity', 'retrying',
];

// ── Helpers ──────────────────────────────────────────────

export function isJobActive(status: PJEJobStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function safeStr(val: string | undefined | null): string {
  return val ?? '';
}

export const logger = {
  info: (modulo: string, msg: string, dados?: unknown) =>
    console.log(`[${modulo}] ${msg}`, dados ?? ''),
  warn: (modulo: string, msg: string, dados?: unknown) =>
    console.warn(`[${modulo}] ${msg}`, dados ?? ''),
  error: (modulo: string, msg: string, dados?: unknown) =>
    console.error(`[${modulo}] ${msg}`, dados ?? ''),
  success: (modulo: string, msg: string, dados?: unknown) =>
    console.log(`[${modulo}] ✓ ${msg}`, dados ?? ''),
};
