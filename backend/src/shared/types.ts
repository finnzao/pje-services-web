export type TipoPolo = 'ATIVO' | 'PASSIVO';

export interface AdvogadoInfo {
  nome: string; oab?: string; cpf?: string; tipoParte: TipoPolo;
}

export interface ParteInfo {
  nome: string; documento?: string; tipoDocumento?: 'CPF' | 'CNPJ';
  participacao?: string; tipoParte: TipoPolo;
}

/** Linha da planilha "Informações Completas": dados da listagem da tarefa + polos lidos dos autos. */
export interface ProcessoAdvogados {
  numeroProcesso: string; idProcesso: number; poloAtivo: string; poloPassivo: string;
  classeJudicial?: string; assuntoPrincipal?: string; orgaoJulgador?: string;
  nomeTarefa?: string; dataChegada?: string; conferido?: boolean; sigiloso?: boolean; prioridade?: boolean;
  etiquetas?: string[]; cargoJudicial?: string; ultimoMovimento?: string; descricaoUltimoMovimento?: string;
  nivelAcesso?: number; podeInserirProcessoSessaoEmLote?: boolean; temParteMoradorDeRua?: boolean;
  partesPoloAtivo: ParteInfo[]; partesPoloPassivo: ParteInfo[];
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

export interface AtribuicaoDigito { digito: number; servidor: string; etiqueta?: EtiquetaServidorRef; }

export interface EtiquetaServidorRef { id: number; nome: string; }
/** Etiqueta do PJE que identifica o servidor na automação por dígito. */
export interface EtiquetaServidor { servidor: string; etiqueta: EtiquetaServidorRef; }

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
  /** Dias parados acima disso viram P1, com ou sem meta. */
  limiarDiasP1: number;
  limiarTempoMortoCnj: number;
  limiarTempoMortoInterno: number;
  limiarCritico: number;
  limiarAlto: number;
  limiarMedio: number;
}

/** sequencial = último algarismo de NNNNNNN · verificador1/2 = 1º/2º algarismo de DD (após o hífen). */
export type ModoDigito = 'sequencial' | 'verificador1' | 'verificador2';

export interface GerarPlanilhaDigitoDTO {
  credentials?: { cpf: string; password: string };
  pjeSessionId?: string;
  pjeProfileIndex?: number;
  /** Dígito → servidor; dígitos ausentes ficam sem atribuição ("Não atribuídos"). */
  atribuicoes: AtribuicaoDigito[];
  /** Tarefas do painel excluídas da análise. */
  tarefasIgnoradas?: string[];
  formato: 'xlsx' | 'zip';
  /** Só número, dígito, etiquetas e dias parados nas abas de processos. */
  reduzida?: boolean;
  /** Qual algarismo do número CNJ define o dígito (padrão: sequencial). */
  modoDigito?: ModoDigito;
  /** Sobrescreve pontualmente os parâmetros do motor de peso. */
  pesos?: Partial<ConfigPeso>;
  /** Etiqueta de cada servidor; habilita a etiquetagem ao final da planilha. */
  etiquetasServidor?: EtiquetaServidor[];
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
  prioridade: 'P1' | 'P2' | 'P3';
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
  /** Presente quando ao menos um servidor tem etiqueta vinculada. */
  etiquetagem?: PlanoEtiquetagemResumo;
}

/** Configuração da tela salva por perfil do PJE, para ser restaurada na próxima visita. */
export interface ServidorConfigDigito { nome: string; digitos: number[]; etiqueta?: EtiquetaServidorRef; }

export interface ConfigAutomacaoDigito {
  versao: number;
  servidores: ServidorConfigDigito[];
  modoDigito: ModoDigito;
  tarefasIgnoradas: string[];
  formato: 'xlsx' | 'zip';
  reduzida: boolean;
  /** Termos que marcam uma tarefa como fila de espera; ausente = padrão do motor. */
  padroesFilaEspera?: string[];
  atualizadoEm: string;
  atualizadoPor?: string;
}

export interface SalvarConfigDigitoDTO {
  pjeSessionId: string;
  config: Omit<ConfigAutomacaoDigito, 'versao' | 'atualizadoEm' | 'atualizadoPor'>;
}

export interface PlanoEtiquetagemResumo {
  inserir: number;
  remover: number;
  processosAfetados: number;
  servidoresSemEtiqueta: string[];
}

export interface EtiquetarPorDigitoDTO {
  credentials?: { cpf: string; password: string };
  pjeSessionId?: string;
  pjeProfileIndex?: number;
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
