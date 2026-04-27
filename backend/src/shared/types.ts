export type PJEDownloadMode = 'by_number' | 'by_task' | 'by_tag';

export interface PJECredentials { cpf: string; password: string; }

export type PJEJobStatus =
  | 'pending' | 'authenticating' | 'awaiting_2fa' | 'selecting_profile'
  | 'processing' | 'downloading' | 'checking_integrity' | 'retrying'
  | 'completed' | 'failed' | 'cancelled' | 'partial';

export interface PJEDownloadProgress {
  jobId: string; status: PJEJobStatus; progress: number;
  totalProcesses: number; successCount: number; failureCount: number;
  currentProcess?: string; files: PJEDownloadedFile[]; errors: PJEDownloadError[];
  message?: string; timestamp: number;
}

export interface PJEDownloadedFile {
  processNumber: string; fileName: string; filePath: string;
  fileSize: number; downloadedAt: string;
}

export interface PJEDownloadError {
  processNumber?: string; message: string; code?: string; timestamp: string;
}

export interface CreateDownloadJobDTO {
  mode: PJEDownloadMode; credentials: PJECredentials;
  processNumbers?: string[]; taskName?: string; isFavorite?: boolean;
  tagId?: number; tagName?: string; documentType?: number; pjeProfileIndex?: number;
}

export interface Submit2FADTO { code: string; }

export interface DownloadJobResponse {
  id: string; userId: number; mode: PJEDownloadMode; status: PJEJobStatus;
  progress: number; totalProcesses: number; successCount: number; failureCount: number;
  files: PJEDownloadedFile[]; errors: PJEDownloadError[];
  createdAt: string; startedAt?: string; completedAt?: string;
}

export const PJE_MAX_CONCURRENT_JOBS = 3;

export interface AdvogadoInfo {
  nome: string; oab?: string; cpf?: string; tipoParte: 'ATIVO' | 'PASSIVO';
}

export interface ProcessoAdvogados {
  numeroProcesso: string; idProcesso: number; poloAtivo: string; poloPassivo: string;
  classeJudicial?: string; assuntoPrincipal?: string; orgaoJulgador?: string;
  advogadosPoloAtivo: AdvogadoInfo[]; advogadosPoloPassivo: AdvogadoInfo[];
  erro?: string;
}

export interface FiltroAdvogado { tipo: 'nome' | 'oab'; valor: string; }

export interface GerarPlanilhaAdvogadosDTO {
  credentials: { cpf: string; password: string };
  fonte: 'by_task' | 'by_tag'; taskName?: string; isFavorite?: boolean;
  tagId?: number; tagName?: string; pjeProfileIndex?: number; pjeSessionId?: string;
  // Compatibilidade: aceita tanto filtro único (legado) quanto array (novo)
  filtro?: FiltroAdvogado;
  filtros?: FiltroAdvogado[];
}

export interface PlanilhaAdvogadosProgress {
  jobId: string; status: 'listing' | 'extracting' | 'generating' | 'completed' | 'failed' | 'cancelled';
  progress: number; totalProcesses: number; processedCount: number;
  currentProcess?: string; message: string; timestamp: number;
}

export interface PlanilhaAdvogadosResult {
  jobId: string; totalProcesses: number; processedCount: number; filteredCount: number;
  fileName?: string; filePath?: string;
  errors: Array<{ processo: string; message: string }>;
}
