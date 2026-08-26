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
  /** Opcional quando pjeSessionId aponta para uma sessão ativa (ex.: após F5, a senha não fica no navegador). */
  credentials?: { cpf: string; password: string };
  fonte: 'by_task' | 'by_tag'; taskName?: string; isFavorite?: boolean;
  tagId?: number; tagName?: string; pjeProfileIndex?: number; pjeSessionId?: string;
  /** Seleção múltipla — quando presentes, têm precedência sobre taskName/tagId. */
  taskNames?: Array<{ name: string; isFavorite?: boolean }>;
  tagIds?: number[];
  filtro?: FiltroAdvogado;
  filtros?: FiltroAdvogado[];
}

export interface PlanilhaAdvogadosProgress {
  jobId: string; status: 'listing' | 'extracting' | 'generating' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
  progress: number; totalProcesses: number; processedCount: number;
  currentProcess?: string; message: string; timestamp: number;
}

export interface PlanilhaAdvogadosResult {
  jobId: string; totalProcesses: number; processedCount: number; filteredCount: number;
  fileName?: string; filePath?: string;
  errors: Array<{ processo: string; message: string }>;
}

export interface PesquisaProcessoCriteria {
  nomeParte?: string;
  outrosNomes?: string;
  nomeAdvogado?: string;
  numeroSequencial?: string;
  numeroDigito?: string;
  numeroAno?: string;
  numeroTribunal?: string;
  numeroOrgao?: string;
  documentoParte?: string;
  assunto?: string;
  classeJudicial?: string;
  numeroDocumento?: string;
  numeroOAB?: string;
  letraOAB?: string;
  ufOAB?: string;
  jurisdicao?: string;
  orgaoJulgador?: string;
  dataAutuacaoInicio?: string;
  dataAutuacaoFim?: string;
  valorCausaInicial?: string;
  valorCausaFinal?: string;
}

export interface ComboOption {
  value: string;
  label: string;
}

export interface SearchFormOptions {
  ufOab: ComboOption[];
  jurisdicoes: ComboOption[];
  orgaosJulgadores: ComboOption[];
}

export interface SearchResultRow {
  idProcesso: string;
  numeroProcesso: string;
  caracteristicas: string;
  orgaoJulgador: string;
  juizGarantias: string;
  autuadoEm: string;
  classeJudicial: string;
  poloAtivo: string;
  poloPassivo: string;
  noAtual: string;
  ultimaMovimentacao: string;
  nosContainer: string;
  nosSingle: string;
}
