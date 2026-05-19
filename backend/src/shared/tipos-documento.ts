export const SELECIONE_SENTINEL = 'Selecione';

export const TIPO_DOCUMENTO_VALUES: Record<string, string | string[]> = {
  [SELECIONE_SENTINEL]: '',

  'Petição Inicial': '12',
  'Petição': '11',
  'Petição (outras)': '11',

  'Despacho': '63',
  'Decisão': '64',
  'Sentença': '86',

  'Intimação': '60',
  'INTIMAÇÃO': '108',
  'Citação': '59',
  'Mandado de Citação': '70',
  'Mandado de Intimação': '71',

  'Acórdão': '85',
  'Decisão Monocrática': '84',
  'Voto': '87',

  'Certidão': '57',
  'Carta': '149',
  'Aviso de recebimento': '115',
  'Contestação': '13',
  'Réplica': '14',
  'Recurso': '16',
  'Embargos': '17',
  'Embargos de Declaração': '18',
  'Apelação': '19',
  'Agravo': '20',

  'Documento': '58',
  'Procuração': '21',
  'Substabelecimento': '22',
  'Laudo': '40',
  'Laudo Pericial': '41',
  'Parecer': '42',

  'Ofício': '50',
  'Manifestação': '15',
  'Termo': '110',
  'Termo de Audiência': '111',
  'Ata': '112',
};

export function isKnownDocumentType(nome: string): boolean {
  return Object.prototype.hasOwnProperty.call(TIPO_DOCUMENTO_VALUES, nome);
}

export function expandSelectedTypes(selecionados: string[]): Array<[string, string]> {
  const limpos = (selecionados || [])
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s) && s !== SELECIONE_SENTINEL);

  if (limpos.length === 0) {
    return [[SELECIONE_SENTINEL, '']];
  }

  const pares: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const nome of limpos) {
    const valor = TIPO_DOCUMENTO_VALUES[nome];
    if (valor === undefined) {
      console.warn(`[TIPOS] Tipo de documento desconhecido: "${nome}" — ignorado`);
      continue;
    }
    if (Array.isArray(valor)) {
      for (const v of valor) {
        const key = `${nome}::${v}`;
        if (!seen.has(key)) {
          seen.add(key);
          pares.push([nome, v]);
        }
      }
    } else {
      const key = `${nome}::${valor}`;
      if (!seen.has(key)) {
        seen.add(key);
        pares.push([nome, valor]);
      }
    }
  }

  if (pares.length === 0) return [[SELECIONE_SENTINEL, '']];

  return pares;
}

export function resolveDocumentTypeIds(nome: string): string[] {
  const valor = TIPO_DOCUMENTO_VALUES[nome];
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

export function listDocumentTypes(): Array<{ nome: string; ids: string[] }> {
  const entries = Object.entries(TIPO_DOCUMENTO_VALUES)
    .filter(([nome]) => nome !== SELECIONE_SENTINEL)
    .map(([nome, valor]) => ({
      nome,
      ids: Array.isArray(valor) ? valor : [valor],
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return [
    { nome: SELECIONE_SENTINEL, ids: [''] },
    ...entries,
  ];
}
