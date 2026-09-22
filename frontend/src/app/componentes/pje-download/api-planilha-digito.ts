import { API_BASE, request } from '../../lib/api-client';

export interface AtribuicaoDigito { digito: number; servidor: string; }
export interface EtiquetaServidor { servidor: string; etiqueta: { id: number; nome: string }; }

/** sequencial = último algarismo antes do hífen · verificador1/2 = 1º/2º algarismo após o hífen. */
export type ModoDigito = 'sequencial' | 'verificador1' | 'verificador2';

export interface GerarPlanilhaDigitoParams {
  /** Opcional quando pjeSessionId aponta para uma sessão ativa (após F5 a senha não fica no navegador). */
  credentials?: { cpf: string; password: string };
  pjeSessionId?: string;
  pjeProfileIndex?: number;
  atribuicoes: AtribuicaoDigito[];
  tarefasIgnoradas?: string[];
  formato: 'xlsx' | 'zip';
  /** Só número, dígito, etiquetas e dias parados. */
  reduzida?: boolean;
  modoDigito?: ModoDigito;
  /** Etiqueta de cada servidor; habilita a etiquetagem ao final. */
  etiquetasServidor?: EtiquetaServidor[];
  /** Ajustes pontuais do motor de peso; hoje só os termos de fila de espera. */
  pesos?: { padroesFilaEspera?: string[] };
}

export interface ServidorConfigDigito { nome: string; digitos: number[]; etiqueta?: { id: number; nome: string }; }

/** Configuração da tela, salva no servidor por perfil do PJE. */
export interface ConfigAutomacaoDigito {
  versao: number;
  servidores: ServidorConfigDigito[];
  modoDigito: ModoDigito;
  tarefasIgnoradas: string[];
  formato: 'xlsx' | 'zip';
  reduzida: boolean;
  padroesFilaEspera?: string[];
  atualizadoEm: string;
  atualizadoPor?: string;
}

export type ConfigAutomacaoDigitoInput = Omit<ConfigAutomacaoDigito, 'versao' | 'atualizadoEm' | 'atualizadoPor'>;

export interface PlanoEtiquetagemResumo {
  inserir: number;
  remover: number;
  processosAfetados: number;
  servidoresSemEtiqueta: string[];
}

export interface PlanilhaDigitoResumo {
  porServidor: Array<{ servidor: string; digitos: number[]; total: number }>;
  naoAtribuidos: { total: number; digitosSemServidor: number[] };
  filasEspera: number;
  metasAUmPasso: Array<{ meta: string; restantes: number; processos: string[] }>;
  semEtiquetaServidor: number;
  etiquetaDivergente: number;
  malformados: number;
  etiquetagem?: PlanoEtiquetagemResumo;
}

export type AcaoEtiquetagemDigito = 'inserida' | 'removida' | 'erro';

export interface ProcessoEtiquetadoDigito {
  idProcesso: number;
  numeroProcesso: string;
  servidor: string;
  etiqueta: string;
  acao: AcaoEtiquetagemDigito;
  erro?: string;
}

export interface EtiquetagemDigitoProgress {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
  progress: number;
  total: number;
  feitos: number;
  inseridas: number;
  removidas: number;
  erros: number;
  message: string;
  timestamp: number;
  processos: ProcessoEtiquetadoDigito[];
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

export async function etiquetarPorDigito(jobId: string, opts: {
  pjeSessionId: string;
  credentials?: { cpf: string; password: string };
  pjeProfileIndex?: number;
}) {
  return request<{ jobId: string; message: string }>(`/api/pje/planilha-digito/${jobId}/etiquetar`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function obterProgressoEtiquetagem(jobId: string) {
  return request<EtiquetagemDigitoProgress>(`/api/pje/planilha-digito/${jobId}/etiquetar/progress`);
}

export async function cancelarEtiquetagemDigito(jobId: string) {
  return request<{ message: string }>(`/api/pje/planilha-digito/${jobId}/etiquetar`, { method: 'DELETE' });
}

export async function obterConfigDigito(pjeSessionId: string) {
  return request<ConfigAutomacaoDigito | null>(`/api/pje/planilha-digito/config?pjeSessionId=${encodeURIComponent(pjeSessionId)}`);
}

export async function salvarConfigDigito(pjeSessionId: string, config: ConfigAutomacaoDigitoInput) {
  return request<ConfigAutomacaoDigito>('/api/pje/planilha-digito/config', {
    method: 'PUT',
    body: JSON.stringify({ pjeSessionId, config }),
  });
}

export async function limparConfigDigito(pjeSessionId: string) {
  return request<{ removida: boolean }>(`/api/pje/planilha-digito/config?pjeSessionId=${encodeURIComponent(pjeSessionId)}`, { method: 'DELETE' });
}

export async function obterPadroesFilaEspera() {
  return request<{ padrao: string[] }>('/api/pje/planilha-digito/padroes-fila-espera');
}
