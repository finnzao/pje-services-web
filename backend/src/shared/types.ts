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

// ───────────────────────── Planilha administrativa por dígito ─────────────────────────

export interface AtribuicaoDigito { digito: number; servidor: string; }

export interface PesosPrioridade {
  /** Prefixos (sem acento, case-insensitive) de etiqueta que marcam meta — ex.: gab_meta, acv_meta. */
  padroesMeta: string[];
  pesoMetaSaude: number;
  pesoMetaJuri: number;
  pesoMetaSaneamento: number;
  pesoMetaOutras: number;
  /** Régua do CNJ para tempo morto (dias sem movimentação). */
  limiarTempoMortoDias: number;
  pesoTempoMorto: number;
  /** Escalada após cruzar a régua: peso extra a cada 30 dias adicionais parado. */
  pesoPor30DiasAdicionais: number;
  tetoEscaladaTempoMorto: number;
  /** Antiguidade (Meta 2): peso por ano desde o ano CNJ do processo. */
  pesoPorAnoAntiguidade: number;
  tetoAntiguidade: number;
  /** Faixas de destaque visual na planilha (dias parados). */
  limiarAlertaDias: number;
  limiarCriticoDias: number;
}

export interface GerarPlanilhaDigitoDTO {
  credentials?: { cpf: string; password: string };
  pjeSessionId?: string;
  pjeProfileIndex?: number;
  /** Dígito → servidor; dígitos ausentes ficam sem atribuição ("Não atribuídos"). */
  atribuicoes: AtribuicaoDigito[];
  /** Tarefas do painel excluídas da análise. */
  tarefasIgnoradas?: string[];
  formato: 'xlsx' | 'zip';
  /** Sobrescreve pontualmente os pesos default de priorização. */
  pesos?: Partial<PesosPrioridade>;
}

export interface ProcessoDigito {
  idProcesso: number;
  numeroProcesso: string;
  /** Último algarismo do sequencial NNNNNNN; null = número malformado. */
  digito: number | null;
  anoCnj: number | null;
  tarefaAtual: string;
  outrasTarefas: string[];
  etiquetas: string[];
  assuntoPrincipal?: string;
  classeJudicial?: string;
  dataUltimoMovimento?: string;
  diasParados: number | null;
  metas: string[];
  prioridade: 'P1' | 'P2' | 'P3' | 'P4';
  pontuacao: number;
  flags: string[];
  servidor?: string;
}

export interface PlanilhaDigitoResumo {
  porServidor: Array<{ servidor: string; digitos: number[]; total: number }>;
  naoAtribuidos: { total: number; digitosSemServidor: number[] };
  semEtiquetaServidor: number;
  etiquetaDivergente: number;
  malformados: number;
}

export interface PlanilhaDigitoProgress {
  jobId: string;
  status: 'listing' | 'enriching' | 'generating' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
  progress: number;
  totalProcesses: number;
  processedCount: number;
  currentProcess?: string;
  message: string;
  timestamp: number;
  /** Preenchidos quando status === 'completed'. */
  fileName?: string;
  resumo?: PlanilhaDigitoResumo;
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
