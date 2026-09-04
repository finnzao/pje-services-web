import { API_BASE, request } from '../../lib/api-client';

export interface AtribuicaoDigito { digito: number; servidor: string; }

export interface GerarPlanilhaDigitoParams {
  /** Opcional quando pjeSessionId aponta para uma sessão ativa (após F5 a senha não fica no navegador). */
  credentials?: { cpf: string; password: string };
  pjeSessionId?: string;
  pjeProfileIndex?: number;
  atribuicoes: AtribuicaoDigito[];
  tarefasIgnoradas?: string[];
  formato: 'xlsx' | 'zip';
}

export interface PlanilhaDigitoResumo {
  porServidor: Array<{ servidor: string; digitos: number[]; total: number }>;
  naoAtribuidos: { total: number; digitosSemServidor: number[] };
  filasEspera: number;
  metasAUmPasso: Array<{ meta: string; restantes: number; processos: string[] }>;
  semEtiquetaServidor: number;
  etiquetaDivergente: number;
  malformados: number;
}

export interface PlanilhaDigitoProgress {
  jobId: string;
  status: string;
  progress: number;
  totalProcesses: number;
  processedCount: number;
  currentProcess?: string;
  message: string;
  timestamp: number;
  fileName?: string;
  resumo?: PlanilhaDigitoResumo;
}

export async function gerarPlanilhaDigito(params: GerarPlanilhaDigitoParams) {
  return request<{ jobId: string; message: string }>('/api/pje/planilha-digito/gerar', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function obterProgressoDigito(jobId: string) {
  return request<PlanilhaDigitoProgress>(`/api/pje/planilha-digito/${jobId}/progress`);
}

export async function cancelarPlanilhaDigito(jobId: string) {
  return request<{ message: string }>(`/api/pje/planilha-digito/${jobId}`, { method: 'DELETE' });
}

/** Baixa o arquivo do job (xlsx ou zip) via fetch com o header x-user. */
export async function downloadPlanilhaDigito(jobId: string): Promise<void> {
  const url = `${API_BASE}/api/pje/planilha-digito/${jobId}/download`;
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
  const fileName = fileNameMatch?.[1] || `planilha_digito_${jobId.slice(0, 8)}.xlsx`;

  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(blobUrl);
}
