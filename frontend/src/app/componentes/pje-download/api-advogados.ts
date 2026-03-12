import { API_BASE, request } from '../../lib/api-client';

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