const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user': JSON.stringify({ id: 1, name: 'Dr. João Magistrado', role: 'magistrado' }),
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const errorMsg = body?.error?.message || body?.message || `HTTP ${res.status}`;
      throw new ApiError(res.status, errorMsg, body);
    }
    return (body?.data ?? body) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof TypeError && err.message === 'Failed to fetch')
      throw new ApiError(0, 'Servidor indisponível. Verifique se a API está em execução.');
    throw err;
  }
}

type PJEDownloadMode = 'by_task' | 'by_tag' | 'by_number';
type PJEJobStatus = 'pending' | 'authenticating' | 'awaiting_2fa' | 'selecting_profile' | 'processing' | 'downloading' | 'checking_integrity' | 'retrying' | 'completed' | 'failed' | 'cancelled' | 'partial';

export async function loginPJE(params: { cpf: string; password: string }) {
  return request<{
    needs2FA: boolean; sessionId?: string;
    user?: { idUsuario: number; nomeUsuario: string; login: string; perfil: string; nomePerfil: string; idUsuarioLocalizacaoMagistradoServidor: number };
    profiles?: Array<{ indice: number; nome: string; orgao: string; favorito: boolean }>;
  }>('/api/pje/downloads/auth/login', { method: 'POST', body: JSON.stringify(params) });
}

export async function enviar2FA(sessionId: string, code: string) {
  return request<{
    needs2FA: boolean; sessionId?: string;
    user?: { idUsuario: number; nomeUsuario: string; login: string; perfil: string; nomePerfil: string; idUsuarioLocalizacaoMagistradoServidor: number };
    profiles?: Array<{ indice: number; nome: string; orgao: string; favorito: boolean }>;
  }>('/api/pje/downloads/auth/2fa', { method: 'POST', body: JSON.stringify({ sessionId, code }) });
}

export async function selecionarPerfil(sessionId: string, profileIndex: number) {
  return request<{
    tasks: Array<{ id: number; nome: string; quantidadePendente: number }>;
    favoriteTasks: Array<{ id: number; nome: string; quantidadePendente: number }>;
    tags: Array<{ id: number; nomeTag: string; nomeTagCompleto: string; favorita: boolean }>;
  }>('/api/pje/downloads/auth/profile', { method: 'POST', body: JSON.stringify({ sessionId, profileIndex }) });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CriarJobParams {
  mode: PJEDownloadMode;
  credentials: { cpf: string; password: string };
  taskName?: string; isFavorite?: boolean;
  tagId?: number; tagName?: string;
  processNumbers?: string[];
  documentType?: number; pjeProfileIndex?: number; pjeSessionId?: string;
}

export async function criarJob(params: CriarJobParams) {
  return request<{
    id: string; userId: number; mode: PJEDownloadMode; status: PJEJobStatus;
    progress: number; totalProcesses: number; successCount: number; failureCount: number;
    files: any[]; errors: any[]; createdAt: string;
  }>('/api/pje/downloads', { method: 'POST', body: JSON.stringify({ ...params, isFavorite: params.isFavorite === true }) });
}

export async function listarJobs(limit = 20, offset = 0) {
  return request<{
    jobs: Array<{
      id: string; userId: number; mode: PJEDownloadMode; status: PJEJobStatus;
      progress: number; totalProcesses: number; successCount: number; failureCount: number;
      files: any[]; errors: any[]; createdAt: string; startedAt?: string; completedAt?: string;
    }>; total: number;
  }>(`/api/pje/downloads?limit=${limit}&offset=${offset}`);
}

export async function obterProgresso(jobId: string) {
  return request<{
    jobId: string; status: PJEJobStatus; progress: number;
    totalProcesses: number; successCount: number; failureCount: number;
    message: string; files: any[]; errors: any[]; timestamp: number;
  } | null>(`/api/pje/downloads/${jobId}/progress`);
}

export async function cancelarJob(jobId: string) {
  return request<{ message: string }>(`/api/pje/downloads/${jobId}`, { method: 'DELETE' });
}
