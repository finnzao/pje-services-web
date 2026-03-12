const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user': JSON.stringify({ id: 1, name: 'Dr. João Magistrado', role: 'magistrado' }),
    ...(options.headers as Record<string, string> || {}),
  };

  const res = await fetch(url, { ...options, headers });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return (body?.data ?? body) as T;
}

export interface GerarPlanilhaParams {
  credentials: { cpf: string; password: string };
  fonte: 'by_task' | 'by_tag';
  taskName?: string;
  isFavorite?: boolean;
  tagId?: number;
  tagName?: string;
  pjeProfileIndex?: number;
  pjeSessionId?: string;
  filtro?: { tipo: 'nome' | 'oab'; valor: string };
}

export async function gerarPlanilhaAdvogados(params: GerarPlanilhaParams) {
  return request<{ jobId: string; message: string }>('/api/pje/advogados/gerar', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function obterProgressoAdvogados(jobId: string) {
  return request<{
    jobId: string; status: string; progress: number;
    totalProcesses: number; processedCount: number;
    currentProcess?: string; message: string; timestamp: number;
  }>(`/api/pje/advogados/${jobId}/progress`);
}

export async function cancelarPlanilhaAdvogados(jobId: string) {
  return request<{ message: string }>(`/api/pje/advogados/${jobId}`, { method: 'DELETE' });
}

export function getDownloadUrl(jobId: string): string {
  return `${API_BASE}/api/pje/advogados/${jobId}/download`;
}
