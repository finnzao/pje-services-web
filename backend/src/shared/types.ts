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

export interface FaixaPontos { ate: number; pontos: number; }
export interface GrupoTermos { nome: string; pontos: number; termos: string[]; }

/**
 * Parâmetros do motor de peso (DOC_Peso_do_Processo_v1):
 * PESO = min(A + B + C + D + E, 100) × F, de 0 a 100.
 */
export interface ConfigPeso {
  // Bloco A — Meta / etiqueta estratégica (máx. 40)
  limiarMetaAUmPasso: number;
  pontosMetaAUmPasso: number;
  /** Pontuação por meta canônica (match por substring, em ordem). */
  pesosMeta: GrupoTermos[];
  pesoMetaDesconhecida: number;
  pesoGabSemMeta: number;
  bonusMetasMultiplas: number;
  /** Prefixos (sem acento/caixa) de etiqueta de meta — ex.: gab_meta, acv_meta. */
  padroesMeta: string[];
  padraoGab: string;
  etiquetaBloqueio: string;
  // Bloco B — Assunto e classe (máx. 20; grupos em ordem decrescente de pontos)
  gruposAssunto: GrupoTermos[];
  pontosAssuntoAusenteRastro: number;
  /** Meta temática → grupo de assunto esperado (gera ASSUNTO_REVISAR se divergir). */
  temasAssuntoPorMeta: Array<{ metaContem: string; grupoAssunto: string }>;
  // Bloco C — Tempo (máx. tetoTempo)
  faixasDiasParados: FaixaPontos[];
  bonusAnoCnj: FaixaPontos[];
  tetoTempo: number;
  // Bloco D — Rastro digital / validação BI
  pontosFlag: Record<string, number>;
  tetoRastro: number;
  // Bloco E — Proximidade da baixa (grupos em ordem decrescente de pontos)
  tarefasProximasBaixa: GrupoTermos[];
  // Bloco F — Situação
  padroesFilaEspera: string[];
  multiplicadorFilaEspera: number;
  // Réguas de tempo morto e faixas de peso
  limiarTempoMortoCnj: number;
  limiarTempoMortoInterno: number;
  limiarCritico: number;
  limiarAlto: number;
  limiarMedio: number;
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
  /** Sobrescreve pontualmente os parâmetros do motor de peso. */
  pesos?: Partial<ConfigPeso>;
}

export type SituacaoProcesso = 'TRABALHAVEL' | 'FILA_ESPERA';
export type FaixaPeso = 'CRITICO' | 'ALTO' | 'MEDIO' | 'NORMAL';

export interface BlocosPeso { A: number; B: number; C: number; D: number; E: number; F: number; }

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
  metaAUmPasso: boolean;
  situacao: SituacaoProcesso;
  bloqueado: boolean;
  prioridade: 'P1' | 'P2' | 'P3' | 'P4';
  /** Peso final 0–100 = min(A+B+C+D+E, 100) × F. */
  pontuacao: number;
  faixa: FaixaPeso;
  blocos: BlocosPeso;
  flags: string[];
  providencias: string[];
  servidor?: string;
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
