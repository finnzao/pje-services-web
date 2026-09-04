import type {
  AtribuicaoDigito, PesosPrioridade, ProcessoDigito,
} from '../../../../shared/types';

/**
 * Pesos default da priorização, calibrados pelo guia "O Motor do BI e a
 * Matemática da Vara": metas de saúde têm rotina diária (bate-volta), Júri
 * pesa na Meta 2, saneamento protege a validade estatística das demais; a
 * régua de tempo morto do CNJ é 100 dias; processos antigos derrubam o TMT.
 */
export const PESOS_PRIORIDADE_PADRAO: PesosPrioridade = {
  padroesMeta: ['gab_meta', 'acv_meta'],
  pesoMetaSaude: 40,
  pesoMetaJuri: 35,
  pesoMetaSaneamento: 30,
  pesoMetaOutras: 20,
  limiarTempoMortoDias: 100,
  pesoTempoMorto: 25,
  pesoPor30DiasAdicionais: 5,
  tetoEscaladaTempoMorto: 25,
  pesoPorAnoAntiguidade: 2,
  tetoAntiguidade: 20,
  limiarAlertaDias: 100,
  limiarCriticoDias: 120,
};

export const FLAGS = {
  TEMPO_MORTO_CNJ: 'TEMPO_MORTO_CNJ',
  ASSUNTO_AUSENTE: 'ASSUNTO_AUSENTE',
  SEM_ULTIMO_MOVIMENTO: 'SEM_ULTIMO_MOVIMENTO',
  SEM_ETIQUETA_SERVIDOR: 'SEM_ETIQUETA_SERVIDOR',
  ETIQUETA_DIVERGENTE: 'ETIQUETA_DIVERGENTE',
  NUMERO_MALFORMADO: 'NUMERO_MALFORMADO',
} as const;

const MS_POR_DIA = 86_400_000;

export function normalizarTexto(texto: string): string {
  return (texto || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Extrai o dígito de distribuição: o último algarismo do sequencial NNNNNNN
 * do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO). Não confundir com o dígito
 * verificador DD — o painel do PJE chama este conceito de
 * "digitoFinalNumeroProcesso". Aceita o número com ou sem máscara.
 */
export function extrairDigito(numeroProcesso: string): { digito: number | null; ano: number | null } {
  const num = (numeroProcesso || '').trim();
  const comMascara = num.match(/^(\d{7})-\d{2}\.(\d{4})\.\d\.\d{2}\.\d{4}$/);
  if (comMascara) {
    return { digito: Number(comMascara[1][6]), ano: Number(comMascara[2]) };
  }
  const soDigitos = num.replace(/\D/g, '');
  if (soDigitos.length === 20) {
    return { digito: Number(soDigitos[6]), ano: Number(soDigitos.slice(9, 13)) };
  }
  return { digito: null, ano: null };
}

/** Valida e indexa as atribuições dígito → servidor (última atribuição do dígito vence). */
export function montarMapaAtribuicoes(atribuicoes: AtribuicaoDigito[]): Map<number, string> {
  const mapa = new Map<number, string>();
  for (const a of atribuicoes || []) {
    const servidor = (a?.servidor || '').trim();
    if (!Number.isInteger(a?.digito) || a.digito < 0 || a.digito > 9 || !servidor) continue;
    mapa.set(a.digito, servidor);
  }
  return mapa;
}

/** Tarefas do painel que entram na análise (todas menos as ignoradas, sem acento/case). */
export function selecionarTarefas(todas: string[], ignoradas: string[] = []): string[] {
  const ignoradasNorm = new Set(ignoradas.map(normalizarTexto).filter(Boolean));
  return todas.filter((t) => t.trim() && !ignoradasNorm.has(normalizarTexto(t)));
}

export function calcularDiasParados(dataUltimoMovimento: string | undefined, agora: Date): number | null {
  if (!dataUltimoMovimento) return null;
  const data = new Date(dataUltimoMovimento);
  if (Number.isNaN(data.getTime())) return null;
  return Math.max(0, Math.floor((agora.getTime() - data.getTime()) / MS_POR_DIA));
}

/** Etiquetas do processo que casam com os padrões de meta (prefixo, sem acento/case). */
export function detectarMetas(etiquetas: string[], pesos: PesosPrioridade): string[] {
  const padroes = pesos.padroesMeta.map(normalizarTexto).filter(Boolean);
  return (etiquetas || []).filter((tag) => {
    const norm = normalizarTexto(tag);
    return padroes.some((p) => norm.startsWith(p));
  });
}

function pesoDaMeta(meta: string, pesos: PesosPrioridade): number {
  const norm = normalizarTexto(meta);
  if (norm.includes('saude')) return pesos.pesoMetaSaude;
  if (norm.includes('juri')) return pesos.pesoMetaJuri;
  if (norm.includes('saneamento')) return pesos.pesoMetaSaneamento;
  return pesos.pesoMetaOutras;
}

/**
 * Pontuação de prioridade (maior = trabalhar antes):
 * meta mais pesada + tempo morto (com escalada) + antiguidade Meta 2.
 */
export function calcularPontuacao(
  proc: Pick<ProcessoDigito, 'metas' | 'diasParados' | 'anoCnj'>,
  pesos: PesosPrioridade,
  anoAtual: number,
): number {
  let pontos = 0;

  if (proc.metas.length > 0) {
    pontos += Math.max(...proc.metas.map((m) => pesoDaMeta(m, pesos)));
  }

  const dias = proc.diasParados ?? 0;
  if (dias >= pesos.limiarTempoMortoDias) {
    const extra = Math.floor((dias - pesos.limiarTempoMortoDias) / 30) * pesos.pesoPor30DiasAdicionais;
    pontos += pesos.pesoTempoMorto + Math.min(extra, pesos.tetoEscaladaTempoMorto);
  }

  if (proc.anoCnj !== null) {
    const anos = Math.max(0, anoAtual - proc.anoCnj);
    pontos += Math.min(anos * pesos.pesoPorAnoAntiguidade, pesos.tetoAntiguidade);
  }

  return pontos;
}

/**
 * Faixa de exibição: P1 = meta já lida pelo BI como tempo morto (pior cenário
 * do guia), P2 = etiqueta de meta, P3 = tempo morto sem meta, P4 = normal.
 */
export function classificarPrioridade(
  proc: Pick<ProcessoDigito, 'metas' | 'diasParados'>,
  pesos: PesosPrioridade,
): 'P1' | 'P2' | 'P3' | 'P4' {
  const temMeta = proc.metas.length > 0;
  const tempoMorto = (proc.diasParados ?? 0) >= pesos.limiarTempoMortoDias;
  if (temMeta && tempoMorto) return 'P1';
  if (temMeta) return 'P2';
  if (tempoMorto) return 'P3';
  return 'P4';
}

/** Ordena por pontuação desc; empate: mais dias parados, depois número (determinístico). */
export function ordenarPorPrioridade(processos: ProcessoDigito[]): ProcessoDigito[] {
  return [...processos].sort((a, b) => {
    if (b.pontuacao !== a.pontuacao) return b.pontuacao - a.pontuacao;
    const diasA = a.diasParados ?? -1;
    const diasB = b.diasParados ?? -1;
    if (diasB !== diasA) return diasB - diasA;
    return a.numeroProcesso.localeCompare(b.numeroProcesso);
  });
}

export interface ResultadoDistribuicao {
  porServidor: Map<string, ProcessoDigito[]>;
  naoAtribuidos: ProcessoDigito[];
}

/**
 * Distribui pelo dígito e audita as etiquetas de servidor: processo cuja
 * etiqueta contém o nome de OUTRO servidor da atribuição é divergência;
 * processo atribuído sem nenhuma etiqueta com o nome do seu servidor recebe
 * SEM_ETIQUETA_SERVIDOR (candidato à etiquetagem em lote).
 */
export function distribuirPorServidor(
  processos: ProcessoDigito[],
  mapa: Map<number, string>,
): ResultadoDistribuicao {
  const porServidor = new Map<string, ProcessoDigito[]>();
  for (const servidor of new Set(mapa.values())) porServidor.set(servidor, []);
  const naoAtribuidos: ProcessoDigito[] = [];

  const servidoresNorm = new Map<string, string>();
  for (const servidor of new Set(mapa.values())) servidoresNorm.set(normalizarTexto(servidor), servidor);

  for (const proc of processos) {
    const servidor = proc.digito !== null ? mapa.get(proc.digito) : undefined;

    const etiquetadosPara = new Set<string>();
    for (const tag of proc.etiquetas) {
      const tagNorm = normalizarTexto(tag);
      for (const [nomeNorm, nomeOriginal] of servidoresNorm) {
        if (tagNorm.includes(nomeNorm)) etiquetadosPara.add(nomeOriginal);
      }
    }

    if (servidor) {
      if (!etiquetadosPara.has(servidor)) proc.flags.push(FLAGS.SEM_ETIQUETA_SERVIDOR);
      if ([...etiquetadosPara].some((s) => s !== servidor)) proc.flags.push(FLAGS.ETIQUETA_DIVERGENTE);
      proc.servidor = servidor;
      porServidor.get(servidor)!.push(proc);
    } else {
      if (proc.digito === null) proc.flags.push(FLAGS.NUMERO_MALFORMADO);
      naoAtribuidos.push(proc);
    }
  }

  return { porServidor, naoAtribuidos };
}
