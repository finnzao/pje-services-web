import type {
  AtribuicaoDigito, BlocosPeso, ConfigPeso, EtiquetaServidor, EtiquetaServidorRef, FaixaPeso, ModoDigito,
  ProcessoDigito, SituacaoProcesso,
} from '../../../../shared/types';

export const FLAGS = {
  TEMPO_MORTO_CNJ: 'TEMPO_MORTO_CNJ',
  TEMPO_MORTO_INTERNO: 'TEMPO_MORTO_INTERNO',
  FILA_META_100D: 'FILA_META_100D',
  ASSUNTO_AUSENTE: 'ASSUNTO_AUSENTE',
  ASSUNTO_REVISAR: 'ASSUNTO_REVISAR',
  DIGITO_DIVERGENTE: 'DIGITO_DIVERGENTE',
  SEM_ETIQUETA_DIGITO: 'SEM_ETIQUETA_DIGITO',
  SEM_ULTIMO_MOVIMENTO: 'SEM_ULTIMO_MOVIMENTO',
  NUMERO_MALFORMADO: 'NUMERO_MALFORMADO',
  BLOQUEADO: 'BLOQUEADO',
} as const;

/** Providência-padrão exibida na planilha para cada flag (DOC_Peso §3.4). */
export const PROVIDENCIAS: Record<string, string> = {
  [FLAGS.FILA_META_100D]: 'Certificar a razão da espera e cobrar o terceiro (ofício à instância superior, MP ou Correios)',
  [FLAGS.ASSUNTO_REVISAR]: 'Retificar o assunto para o ramo correto da TPU antes de qualquer outro ato',
  [FLAGS.ASSUNTO_AUSENTE]: 'Cadastrar o assunto principal (TPU)',
  [FLAGS.DIGITO_DIVERGENTE]: 'Reetiquetar — a etiqueta aponta para outro servidor/dígito (o cálculo prevalece)',
  [FLAGS.BLOQUEADO]: 'GAB_nao trabalhar: exige confirmação do gabinete para liberar',
};

// Falta de etiqueta é resolvida pela etiquetagem automática, não é problema de BI.
const FLAGS_FORA_DA_VALIDACAO_BI: ReadonlySet<string> = new Set([FLAGS.SEM_ETIQUETA_DIGITO]);

export function flagsValidacaoBi(flags: string[]): string[] {
  return flags.filter((f) => !FLAGS_FORA_DA_VALIDACAO_BI.has(f));
}

/**
 * Parâmetros default do motor de peso, transcritos do
 * DOC_Peso_do_Processo_v1 (§3.1–3.6 e §10). Termos comparados sem
 * acento/caixa, por substring.
 */
export const CONFIG_PESO_PADRAO: ConfigPeso = {
  // A — Meta / etiqueta estratégica
  limiarMetaAUmPasso: 2,
  pontosMetaAUmPasso: 40,
  pesosMeta: [
    { nome: 'saude', pontos: 36, termos: ['saude'] },
    { nome: 'juri', pontos: 32, termos: ['juri'] },
    { nome: 'improbidade', pontos: 30, termos: ['improbidade'] },
    { nome: 'mais antigos', pontos: 26, termos: ['antigo'] },
    { nome: 'ambiental', pontos: 24, termos: ['ambient'] },
    { nome: 'saneamento', pontos: 22, termos: ['saneamento'] },
    { nome: 'meta 2', pontos: 26, termos: ['2'] },
  ],
  pesoMetaDesconhecida: 22,
  pesoGabSemMeta: 12,
  bonusMetasMultiplas: 5,
  padroesMeta: ['gab_meta', 'acv_meta'],
  padraoGab: 'gab_',
  etiquetaBloqueio: 'gab_nao trabalhar',
  // B — Assunto e classe
  gruposAssunto: [
    { nome: 'B1', pontos: 20, termos: ['saude', 'medicament', 'insumo', 'internacao', 'vaga de uti', 'leito', 'tratamento medico', 'hospitalar', 'plano de saude'] },
    { nome: 'B2', pontos: 16, termos: ['civil publica', 'acpciv', 'improbidade', 'principios administrativos', 'dano ao erario', 'ambient', 'mandado de seguranca', 'msciv'] },
    { nome: 'B3', pontos: 14, termos: ['alimentos', 'guarda', 'paternidade', 'interd', 'uniao estavel', 'parentesco', 'exealiij', 'dissolucao'] },
    { nome: 'B4', pontos: 11, termos: ['inclusao indevida', 'cadastro de inadimplentes', 'consignado', 'desconto em folha', 'beneficio previdenciario', 'energia', 'agua', 'obrigacao de fazer'] },
    { nome: 'B5', pontos: 6, termos: ['dano moral', 'dano material', 'imagem', 'contrat', 'alienacao fiduciaria', 'cedula de credito', 'cheque', 'duplicata', 'acidente de transito', 'usucapiao', 'inventario', 'partilha', 'rescisao'] },
    { nome: 'B6', pontos: 4, termos: ['divida ativa', 'exfis', 'execucao fiscal', 'icms', 'pasep', 'cumsenfaz', 'piso', 'gratificac'] },
  ],
  pontosAssuntoAusenteRastro: 8,
  temasAssuntoPorMeta: [
    { metaContem: 'saude', grupoAssunto: 'B1' },
    { metaContem: 'ambient', grupoAssunto: 'B2' },
    { metaContem: 'improbidade', grupoAssunto: 'B2' },
  ],
  // C — Tempo
  faixasDiasParados: [
    { ate: 30, pontos: 0 },
    { ate: 60, pontos: 4 },
    { ate: 100, pontos: 9 },
    { ate: 120, pontos: 16 },
    { ate: 9_999_999, pontos: 20 },
  ],
  bonusAnoCnj: [
    { ate: 2019, pontos: 5 },
    { ate: 2022, pontos: 3 },
    { ate: 2024, pontos: 1 },
  ],
  tetoTempo: 25,
  // D — Rastro digital
  pontosFlag: {
    [FLAGS.FILA_META_100D]: 10,
    [FLAGS.ASSUNTO_REVISAR]: 8,
    [FLAGS.ASSUNTO_AUSENTE]: 8,
    [FLAGS.DIGITO_DIVERGENTE]: 2,
  },
  tetoRastro: 15,
  // E — Proximidade da baixa
  tarefasProximasBaixa: [
    { nome: 'baixa', pontos: 10, termos: ['certificar decurso', 'existencia de recursos', 'arquivo definitivo', 'certificar transito'] },
    { nome: 'ato pronto', pontos: 6, termos: ['assinar ato em cartorio', 'assinar carta', 'imprimir expediente', 'determinacoes - urgentes'] },
    { nome: 'analise', pontos: 3, termos: ['verificar providencia', 'cumprir determinacoes', 'triagem de processo', 'documentos nao lidos', 'pendencia em execucao fiscal'] },
  ],
  // F — Situação
  padroesFilaEspera: [
    '(susp)', 'suspens', 'instancia superior', 'artigo 40', 'art. 40', 'parcelamento',
    'e-carta', 'aguardar decurso', 'aguardando apreciacao', 'aguardar resposta',
    'aguardando retorno', 'ministerio publico', 'aguardar prazo',
  ],
  multiplicadorFilaEspera: 0.3,
  // Réguas e faixas
  limiarDiasP1: 30,
  limiarTempoMortoCnj: 100,
  limiarTempoMortoInterno: 120,
  limiarCritico: 70,
  limiarAlto: 50,
  limiarMedio: 30,
};

const MS_POR_DIA = 86_400_000;

export function normalizarTexto(texto: string): string {
  return (texto || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function contemAlgum(alvo: string, termos: string[]): boolean {
  return termos.some((t) => t && alvo.includes(normalizarTexto(t)));
}

/**
 * Extrai o dígito de distribuição do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO).
 * Por padrão é o último algarismo do sequencial NNNNNNN (o painel do PJE chama
 * de "digitoFinalNumeroProcesso"); o modo permite usar o 1º ou o 2º algarismo
 * do verificador DD. Aceita o número com ou sem máscara.
 */
export function extrairDigito(
  numeroProcesso: string,
  modo: ModoDigito = 'sequencial',
): { digito: number | null; ano: number | null } {
  const soDigitos = (numeroProcesso || '').replace(/\D/g, '');
  if (soDigitos.length !== 20) return { digito: null, ano: null };
  const posicao = modo === 'verificador1' ? 7 : modo === 'verificador2' ? 8 : 6;
  return { digito: Number(soDigitos[posicao]), ano: Number(soDigitos.slice(9, 13)) };
}

function digitoValido(digito: unknown): digito is number {
  return Number.isInteger(digito) && (digito as number) >= 0 && (digito as number) <= 9;
}

/** Valida e indexa as atribuições dígito → servidor (última atribuição do dígito vence). */
export function montarMapaAtribuicoes(atribuicoes: AtribuicaoDigito[]): Map<number, string> {
  const mapa = new Map<number, string>();
  const canonicos = new Map<string, string>();
  for (const a of atribuicoes || []) {
    const servidor = (a?.servidor || '').trim();
    if (!digitoValido(a?.digito) || !servidor) continue;
    const chave = normalizarTexto(servidor);
    if (!canonicos.has(chave)) canonicos.set(chave, servidor);
    mapa.set(a.digito, canonicos.get(chave)!);
  }
  return mapa;
}

/** Tarefas do painel que entram na análise (todas menos as ignoradas, sem acento/case). */
export function selecionarTarefas(todas: string[], ignoradas: string[] = []): string[] {
  const ignoradasNorm = new Set(ignoradas.map(normalizarTexto).filter(Boolean));
  return todas.filter((t) => t.trim() && !ignoradasNorm.has(normalizarTexto(t)));
}

/**
 * Normaliza uma data vinda do REST legado do PJE, que alterna entre epoch em
 * milissegundos (Jackson), ISO 8601 (inclusive com offset "+0000") e o formato
 * brasileiro "dd/MM/yyyy HH:mm". Devolve string parseável por new Date().
 */
export function parseDataPje(valor: unknown): string | undefined {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
    const ms = valor < 1e11 ? valor * 1000 : valor;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof valor === 'string') {
    const s = valor.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (br) {
      const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = br;
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
    }
  }
  return undefined;
}

export function calcularDiasParados(dataUltimoMovimento: string | undefined, agora: Date): number | null {
  if (!dataUltimoMovimento) return null;
  const data = new Date(dataUltimoMovimento);
  if (Number.isNaN(data.getTime())) return null;
  return Math.max(0, Math.floor((agora.getTime() - data.getTime()) / MS_POR_DIA));
}

/**
 * Nome canônico da meta a partir da etiqueta (GAB_Meta_saude e "ACV_Meta saude"
 * são a mesma meta "saude"); null quando a etiqueta não é de meta.
 */
export function normalizarMeta(etiqueta: string, config: ConfigPeso): string | null {
  const norm = normalizarTexto(etiqueta);
  for (const prefixo of config.padroesMeta) {
    const p = normalizarTexto(prefixo);
    if (p && norm.startsWith(p)) {
      const resto = norm.slice(p.length).replace(/^[\s_-]+/, '').trim();
      return resto || null;
    }
  }
  return null;
}

/** Metas canônicas do processo, sem duplicatas. */
export function metasDoProcesso(etiquetas: string[], config: ConfigPeso): string[] {
  const metas = new Set<string>();
  for (const tag of etiquetas || []) {
    const meta = normalizarMeta(tag, config);
    if (meta) metas.add(meta);
  }
  return [...metas];
}

function temGabSemMeta(etiquetas: string[], config: ConfigPeso): boolean {
  const bloqueio = normalizarTexto(config.etiquetaBloqueio);
  const gab = normalizarTexto(config.padraoGab);
  return (etiquetas || []).some((tag) => {
    const norm = normalizarTexto(tag);
    return norm.startsWith(gab) && norm !== bloqueio && normalizarMeta(tag, config) === null;
  });
}

export function ehBloqueado(etiquetas: string[], config: ConfigPeso): boolean {
  const bloqueio = normalizarTexto(config.etiquetaBloqueio);
  return (etiquetas || []).some((tag) => normalizarTexto(tag) === bloqueio);
}

function pontosDaMeta(meta: string, config: ConfigPeso): number {
  const norm = normalizarTexto(meta);
  for (const grupo of config.pesosMeta) {
    if (contemAlgum(norm, grupo.termos)) return grupo.pontos;
  }
  return config.pesoMetaDesconhecida;
}

/** Bloco A — usa a maior meta; +bônus com 2+ metas; 40 se alguma meta está a um passo. */
export function calcularBlocoA(
  metas: string[],
  etiquetas: string[],
  metasRestantes: Map<string, number>,
  config: ConfigPeso,
): { pontos: number; metaAUmPasso: boolean } {
  const aUmPasso = metas.some((m) => (metasRestantes.get(m) ?? Infinity) <= config.limiarMetaAUmPasso);
  if (aUmPasso) return { pontos: config.pontosMetaAUmPasso, metaAUmPasso: true };

  let pontos = 0;
  if (metas.length > 0) pontos = Math.max(...metas.map((m) => pontosDaMeta(m, config)));
  else if (temGabSemMeta(etiquetas, config)) pontos = config.pesoGabSemMeta;
  if (metas.length >= 2) pontos = Math.min(pontos + config.bonusMetasMultiplas, config.pontosMetaAUmPasso);
  return { pontos, metaAUmPasso: false };
}

/** Bloco B — maior grupo aplicável ao assunto/classe. */
export function calcularBlocoB(
  assunto: string | undefined,
  classe: string | undefined,
  config: ConfigPeso,
): { pontos: number; grupo: string | null } {
  const alvo = normalizarTexto(`${assunto || ''} ${classe || ''}`);
  if (!alvo) return { pontos: 0, grupo: null };
  for (const grupo of config.gruposAssunto) {
    if (contemAlgum(alvo, grupo.termos)) return { pontos: grupo.pontos, grupo: grupo.nome };
  }
  return { pontos: 0, grupo: null };
}

/** Bloco C — faixa de dias parados + bônus de antiguidade, com teto. */
export function calcularBlocoC(diasParados: number | null, anoCnj: number | null, config: ConfigPeso): number {
  const dias = diasParados ?? 0;
  let c1 = 0;
  for (const faixa of config.faixasDiasParados) {
    if (dias <= faixa.ate) { c1 = faixa.pontos; break; }
  }
  let c2 = 0;
  if (anoCnj !== null) {
    for (const faixa of config.bonusAnoCnj) {
      if (anoCnj <= faixa.ate) { c2 = faixa.pontos; break; }
    }
  }
  return Math.min(c1 + c2, config.tetoTempo);
}

/** Bloco E — proximidade da baixa pela tarefa trabalhável mais avançada (filas não pontuam). */
export function calcularBlocoE(tarefas: string[], situacao: SituacaoProcesso, config: ConfigPeso): number {
  if (situacao !== 'TRABALHAVEL') return 0;
  let melhor = 0;
  for (const tarefa of tarefas) {
    if (ehFilaDeEspera(tarefa, config)) continue;
    const norm = normalizarTexto(tarefa);
    for (const grupo of config.tarefasProximasBaixa) {
      if (grupo.pontos > melhor && contemAlgum(norm, grupo.termos)) melhor = grupo.pontos;
    }
  }
  return melhor;
}

export function ehFilaDeEspera(tarefa: string, config: ConfigPeso): boolean {
  const norm = normalizarTexto(tarefa);
  return config.padroesFilaEspera.some((p) => norm.includes(normalizarTexto(p)));
}

/** Trabalhável se ao menos uma tarefa está fora da lista de filas de espera. */
export function classificarSituacao(tarefas: string[], config: ConfigPeso): SituacaoProcesso {
  const temTrabalhavel = tarefas.some((t) => t.trim() && !ehFilaDeEspera(t, config));
  return temTrabalhavel ? 'TRABALHAVEL' : 'FILA_ESPERA';
}

export interface AvaliacaoPeso {
  peso: number;
  faixa: FaixaPeso;
  prioridade: 'P1' | 'P2' | 'P3';
  situacao: SituacaoProcesso;
  bloqueado: boolean;
  metaAUmPasso: boolean;
  blocos: BlocosPeso;
  flags: string[];
  providencias: string[];
}

export interface DadosAvaliacao {
  metas: string[];
  etiquetas: string[];
  assuntoPrincipal?: string;
  classeJudicial?: string;
  diasParados: number | null;
  anoCnj: number | null;
  tarefas: string[];
  /** Flags pré-existentes (etiquetagem, dados ausentes) que entram no bloco D quando pontuadas. */
  flagsBase?: string[];
}

/**
 * Motor de peso completo (DOC_Peso_do_Processo_v1 §3–§5):
 * PESO = min(A+B+C+D+E, 100) × F. P1 ⇔ dias > limiarDiasP1 (com ou sem meta) ·
 * P2 ⇔ A≥12 (Meta/GAB) · P3 restante.
 */
export function avaliarProcesso(
  dados: DadosAvaliacao,
  metasRestantes: Map<string, number>,
  config: ConfigPeso,
): AvaliacaoPeso {
  const flags = [...(dados.flagsBase ?? [])];
  const situacao = classificarSituacao(dados.tarefas, config);
  const bloqueado = ehBloqueado(dados.etiquetas, config);
  const dias = dados.diasParados ?? 0;

  const { pontos: A, metaAUmPasso } = calcularBlocoA(dados.metas, dados.etiquetas, metasRestantes, config);
  const { pontos: B, grupo: grupoAssunto } = calcularBlocoB(dados.assuntoPrincipal, dados.classeJudicial, config);
  const C = calcularBlocoC(dados.diasParados, dados.anoCnj, config);

  if (dias > config.limiarTempoMortoCnj) flags.push(FLAGS.TEMPO_MORTO_CNJ);
  if (dias > config.limiarTempoMortoInterno) flags.push(FLAGS.TEMPO_MORTO_INTERNO);
  if (!dados.assuntoPrincipal?.trim()) flags.push(FLAGS.ASSUNTO_AUSENTE);
  if (situacao === 'FILA_ESPERA' && dados.metas.length > 0 && dias > config.limiarTempoMortoCnj) {
    flags.push(FLAGS.FILA_META_100D);
  }
  // Etiqueta temática cujo assunto não pertence ao grupo esperado (ex.: GAB_Meta_saude
  // com assunto "Reajuste contratual") — o Datajud não vai ler o processo na meta.
  if (dados.assuntoPrincipal?.trim()) {
    for (const tema of config.temasAssuntoPorMeta) {
      const temMetaTema = dados.metas.some((m) => normalizarTexto(m).includes(normalizarTexto(tema.metaContem)));
      if (temMetaTema && grupoAssunto !== tema.grupoAssunto) {
        flags.push(FLAGS.ASSUNTO_REVISAR);
        break;
      }
    }
  }
  if (bloqueado) flags.push(FLAGS.BLOQUEADO);

  const D = Math.min(
    flags.reduce((acc, f) => acc + (config.pontosFlag[f] ?? 0), 0),
    config.tetoRastro,
  );
  const E = calcularBlocoE(dados.tarefas, situacao, config);
  const F = situacao === 'TRABALHAVEL' ? 1 : config.multiplicadorFilaEspera;

  const bruto = Math.min(A + B + C + D + E, 100);
  const peso = Math.round(bruto * F);

  const faixa: FaixaPeso = peso >= config.limiarCritico ? 'CRITICO'
    : peso >= config.limiarAlto ? 'ALTO'
      : peso >= config.limiarMedio ? 'MEDIO' : 'NORMAL';

  const prioridade: AvaliacaoPeso['prioridade'] = dias > config.limiarDiasP1 ? 'P1'
    : A >= config.pesoGabSemMeta ? 'P2' : 'P3';

  const providencias = flags
    .map((f) => PROVIDENCIAS[f])
    .filter((p): p is string => Boolean(p));

  return { peso, faixa, prioridade, situacao, bloqueado, metaAUmPasso, blocos: { A, B, C, D, E, F }, flags, providencias };
}

/**
 * Ordem de trabalho: mais dias parados primeiro; com os mesmos dias, processo de
 * meta vem antes; depois peso desc → ano asc → número asc.
 */
export function ordenarPorDiasParados(processos: ProcessoDigito[]): ProcessoDigito[] {
  return [...processos].sort((a, b) => {
    const diasA = a.diasParados ?? -1;
    const diasB = b.diasParados ?? -1;
    if (diasB !== diasA) return diasB - diasA;
    const metaA = a.metas.length > 0 ? 1 : 0;
    const metaB = b.metas.length > 0 ? 1 : 0;
    if (metaB !== metaA) return metaB - metaA;
    if (b.pontuacao !== a.pontuacao) return b.pontuacao - a.pontuacao;
    const anoA = a.anoCnj ?? 9999;
    const anoB = b.anoCnj ?? 9999;
    if (anoA !== anoB) return anoA - anoB;
    return a.numeroProcesso.localeCompare(b.numeroProcesso);
  });
}

export interface ResultadoDistribuicao {
  porServidor: Map<string, ProcessoDigito[]>;
  naoAtribuidos: ProcessoDigito[];
}

function refEtiquetaValida(etiqueta: unknown): EtiquetaServidorRef | null {
  if (!etiqueta || typeof etiqueta !== 'object') return null;
  const e = etiqueta as Record<string, unknown>;
  const id = Number(e.id);
  const nome = typeof e.nome === 'string' ? e.nome.trim() : '';
  return Number.isInteger(id) && id > 0 && nome ? { id, nome } : null;
}

export function montarMapaEtiquetas(
  atribuicoes: AtribuicaoDigito[] | undefined,
  mapa: Map<number, string>,
  etiquetasServidor?: EtiquetaServidor[],
): Map<number, EtiquetaServidorRef> {
  const porDigito = new Map<number, EtiquetaServidorRef>();
  for (const a of atribuicoes ?? []) {
    if (!digitoValido(a?.digito) || !(a.servidor || '').trim() || !mapa.has(a.digito)) continue;
    const ref = refEtiquetaValida(a.etiqueta);
    if (ref) porDigito.set(a.digito, ref);
    else porDigito.delete(a.digito);
  }

  for (const item of etiquetasServidor ?? []) {
    const chave = normalizarTexto(item?.servidor ?? '');
    const ref = refEtiquetaValida(item?.etiqueta);
    if (!chave || !ref) continue;
    for (const [digito, servidor] of mapa) {
      if (!porDigito.has(digito) && normalizarTexto(servidor) === chave) porDigito.set(digito, ref);
    }
  }

  const donoPorId = new Map<number, string>();
  for (const [digito, ref] of [...porDigito].sort((a, b) => a[0] - b[0])) {
    const dono = mapa.get(digito)!;
    const atual = donoPorId.get(ref.id);
    if (atual === undefined) donoPorId.set(ref.id, dono);
    else if (atual !== dono) porDigito.delete(digito);
  }
  return porDigito;
}

interface IndiceEtiquetas {
  vinculadas: Map<string, EtiquetaServidorRef>;
  semVinculo: Map<string, string>;
}

function indexarEtiquetas(mapa: Map<number, string>, etiquetasDigito: Map<number, EtiquetaServidorRef>): IndiceEtiquetas {
  const vinculadas = new Map<string, EtiquetaServidorRef>();
  const comVinculo = new Set<string>();
  for (const [digito, ref] of etiquetasDigito) {
    const servidor = mapa.get(digito);
    if (!servidor) continue;
    comVinculo.add(servidor);
    const nome = normalizarTexto(ref.nome);
    if (!vinculadas.has(nome)) vinculadas.set(nome, ref);
  }
  const semVinculo = new Map<string, string>();
  for (const servidor of new Set(mapa.values())) {
    if (!comVinculo.has(servidor)) semVinculo.set(normalizarTexto(servidor), servidor);
  }
  return { vinculadas, semVinculo };
}

function auditarEtiquetas(
  etiquetas: string[],
  servidor: string,
  propria: EtiquetaServidorRef | undefined,
  indice: IndiceEtiquetas,
): { temPropria: boolean; divergente: boolean } {
  const propriaNorm = propria ? normalizarTexto(propria.nome) : null;
  const servidorNorm = normalizarTexto(servidor);
  let temPropria = false;
  let divergente = false;
  for (const tag of etiquetas) {
    const tagNorm = normalizarTexto(tag);
    if (indice.vinculadas.has(tagNorm)) {
      if (tagNorm === propriaNorm) temPropria = true;
      else divergente = true;
      continue;
    }
    if (propriaNorm === null && tagNorm.includes(servidorNorm)) temPropria = true;
    for (const [nomeNorm, outro] of indice.semVinculo) {
      if (outro !== servidor && tagNorm.includes(nomeNorm)) divergente = true;
    }
  }
  return { temPropria, divergente };
}

/**
 * Distribui pelo dígito e audita as etiquetas de servidor: processo cuja
 * etiqueta contém o nome de OUTRO servidor da atribuição é divergência;
 * processo atribuído sem nenhuma etiqueta com o nome do seu servidor recebe
 * SEM_ETIQUETA_DIGITO (candidato à etiquetagem em lote).
 */
export function distribuirPorServidor(
  processos: ProcessoDigito[],
  mapa: Map<number, string>,
  etiquetasDigito: Map<number, EtiquetaServidorRef> = new Map(),
): ResultadoDistribuicao {
  const porServidor = new Map<string, ProcessoDigito[]>();
  for (const servidor of new Set(mapa.values())) porServidor.set(servidor, []);
  const naoAtribuidos: ProcessoDigito[] = [];
  const indice = indexarEtiquetas(mapa, etiquetasDigito);

  for (const proc of processos) {
    const servidor = proc.digito !== null ? mapa.get(proc.digito) : undefined;

    if (servidor && proc.digito !== null) {
      const { temPropria, divergente } = auditarEtiquetas(proc.etiquetas, servidor, etiquetasDigito.get(proc.digito), indice);
      if (!temPropria) proc.flags.push(FLAGS.SEM_ETIQUETA_DIGITO);
      if (divergente) proc.flags.push(FLAGS.DIGITO_DIVERGENTE);
      proc.servidor = servidor;
      porServidor.get(servidor)!.push(proc);
    } else {
      if (proc.digito === null) proc.flags.push(FLAGS.NUMERO_MALFORMADO);
      naoAtribuidos.push(proc);
    }
  }

  return { porServidor, naoAtribuidos };
}

export interface ItemEtiquetagem {
  idProcesso: number;
  numeroProcesso: string;
  servidor: string;
  inserir?: EtiquetaServidorRef;
  remover: EtiquetaServidorRef[];
}

export function planejarEtiquetagem(
  porServidor: Map<string, ProcessoDigito[]>,
  etiquetasDigito: Map<number, EtiquetaServidorRef>,
): ItemEtiquetagem[] {
  const vinculadas = new Map<string, EtiquetaServidorRef>();
  for (const ref of etiquetasDigito.values()) {
    const nome = normalizarTexto(ref.nome);
    if (!vinculadas.has(nome)) vinculadas.set(nome, ref);
  }

  const plano: ItemEtiquetagem[] = [];
  for (const [servidor, lista] of porServidor) {
    for (const proc of lista) {
      const propria = proc.digito !== null ? etiquetasDigito.get(proc.digito) : undefined;
      if (!propria) continue;
      const propriaNorm = normalizarTexto(propria.nome);
      const atuais = new Set(proc.etiquetas.map(normalizarTexto));
      const remover: EtiquetaServidorRef[] = [];
      for (const [nomeNorm, ref] of vinculadas) {
        if (nomeNorm !== propriaNorm && ref.id !== propria.id && atuais.has(nomeNorm)) remover.push(ref);
      }
      const inserir = atuais.has(propriaNorm) ? undefined : propria;
      if (!inserir && remover.length === 0) continue;
      plano.push({ idProcesso: proc.idProcesso, numeroProcesso: proc.numeroProcesso, servidor, inserir, remover });
    }
  }
  return plano;
}
