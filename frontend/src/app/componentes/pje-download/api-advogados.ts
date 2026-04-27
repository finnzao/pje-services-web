import { API_BASE, request } from '../../lib/api-client';
import type { FiltroAdvogado } from './types';

export interface GerarPlanilhaParams {
  credentials: { cpf: string; password: string };
  fonte: 'by_task' | 'by_tag';
  taskName?: string;
  isFavorite?: boolean;
  tagId?: number;
  tagName?: string;
  pjeProfileIndex?: number;
  pjeSessionId?: string;
  filtros?: FiltroAdvogado[];
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

/**
 * Baixa a planilha via fetch (com header x-user) e dispara o download.
 */
export async function downloadPlanilha(jobId: string): Promise<void> {
  const url = `${API_BASE}/api/pje/advogados/${jobId}/download`;
  const res = await fetch(url, {
    headers: {
      'x-user': JSON.stringify({ id: 1, name: 'Dr. João Magistrado', role: 'magistrado' }),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition');
  const fileNameMatch = disposition?.match(/filename="?([^"]+)"?/);
  const fileName = fileNameMatch?.[1] || `advogados_pje_${jobId.slice(0, 8)}.xlsx`;

  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(blobUrl);
}
