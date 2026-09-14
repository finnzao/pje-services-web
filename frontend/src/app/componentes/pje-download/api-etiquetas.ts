import { request } from '../../lib/api-client';

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

export async function obterExecucaoEtiquetas(id: string) {
  return request<ExecucaoEtiquetas>(`/api/pje/etiquetas/execucoes/${id}`);
}

export async function cancelarExecucaoEtiquetas(id: string) {
  return request<{ message: string }>(`/api/pje/etiquetas/execucoes/${id}`, { method: 'DELETE' });
}
