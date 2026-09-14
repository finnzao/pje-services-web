import { API_BASE, request } from '../../lib/api-client';

export interface EtiquetaRef { id: number; nome: string; }

export interface EtiquetasConfig {
  ativo: boolean;
  diasParado: number;
  etiqueta: EtiquetaRef | null;
  tarefasIgnoradas: string[];
  horaExecucao: string;
  removerQuandoMovimentado: boolean;
  limitePorExecucao: number;
  sessao: { pjeSessionId?: string; cpf?: string; pjeProfileIndex?: number };
  atualizadoEm: string;
  atualizadoPor?: string;
}

export type MotivoIgnorado =
  | 'TAREFA_IGNORADA' | 'SEM_DATA_MOVIMENTO' | 'DENTRO_DO_PRAZO' | 'JA_ETIQUETADO' | 'LIMITE_EXECUCAO';

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

export interface ExecucaoEtiquetas {
  id: string;
  origem: 'agendada' | 'manual';
  dryRun: boolean;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  etapa: 'sessao' | 'listando' | 'enriquecendo' | 'aplicando' | 'concluido';
  progresso: number;
  mensagem: string;
  iniciadoEm: string;
  finalizadoEm?: string;
  totais: {
    tarefasConsideradas: number;
    tarefasIgnoradas: number;
    processosListados: number;
    candidatos: number;
    inseridas: number;
    removidas: number;
    erros: number;
    ignorados: Record<MotivoIgnorado, number>;
  };
  processos: ProcessoAfetado[];
  configSnapshot: Pick<EtiquetasConfig, 'diasParado' | 'etiqueta' | 'tarefasIgnoradas' | 'removerQuandoMovimentado' | 'limitePorExecucao'>;
  erro?: string;
}

/** Parâmetros da etiquetagem manual — são gravados na configuração do serviço (a mesma que a rotina automática usará no futuro). */
export interface ParametrosEtiquetagem {
  diasParado: number;
  etiqueta: EtiquetaRef;
  tarefasIgnoradas: string[];
  removerQuandoMovimentado: boolean;
  pjeSessionId: string;
  pjeProfileIndex?: number;
}

export async function obterConfigEtiquetas() {
  return request<EtiquetasConfig>('/api/pje/etiquetas/config');
}

export async function salvarConfigEtiquetas(params: ParametrosEtiquetagem) {
  return request<EtiquetasConfig>('/api/pje/etiquetas/config', {
    method: 'PUT',
    body: JSON.stringify({
      diasParado: params.diasParado,
      etiqueta: params.etiqueta,
      tarefasIgnoradas: params.tarefasIgnoradas,
      removerQuandoMovimentado: params.removerQuandoMovimentado,
      sessao: { pjeSessionId: params.pjeSessionId, pjeProfileIndex: params.pjeProfileIndex ?? null },
    }),
  });
}

export async function executarEtiquetagem(opts: {
  dryRun: boolean;
  pjeSessionId: string;
  credentials?: { cpf: string; password: string };
  pjeProfileIndex?: number;
}) {
  return request<{ execucaoId: string; message: string }>('/api/pje/etiquetas/executar', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

/** Resumo das execuções anteriores (sem a lista de processos), mais recentes primeiro. */
export type ExecucaoResumo = Omit<ExecucaoEtiquetas, 'processos'>;

export async function listarExecucoesEtiquetas() {
  return request<ExecucaoResumo[]>('/api/pje/etiquetas/execucoes');
}

export async function obterExecucaoEtiquetas(id: string) {
  return request<ExecucaoEtiquetas>(`/api/pje/etiquetas/execucoes/${id}`);
}

export async function cancelarExecucaoEtiquetas(id: string) {
  return request<{ message: string }>(`/api/pje/etiquetas/execucoes/${id}`, { method: 'DELETE' });
}

/** Baixa a planilha (.xlsx) dos processos afetados pela execução, via fetch com o header x-user. */
export async function downloadPlanilhaExecucao(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pje/etiquetas/execucoes/${id}/planilha`, {
    headers: { 'x-user': JSON.stringify({ id: 1, name: 'Dr. João Magistrado', role: 'magistrado' }) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const fileName = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1]
    || `processos_parados_${id.slice(0, 8)}.xlsx`;
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(blobUrl);
}
