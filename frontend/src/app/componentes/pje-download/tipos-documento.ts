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

export interface TipoDocumentoUI {
  nome: string;
  ids: string[];
}

export function listDocumentTypes(): TipoDocumentoUI[] {
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

export function validateDocumentTypes(selecionados: string[]): {
  valid: boolean; unknown: string[];
} {
  const unknown = selecionados.filter(
    (n) => n && n !== SELECIONE_SENTINEL && !(n in TIPO_DOCUMENTO_VALUES),
  );
  return { valid: unknown.length === 0, unknown };
}
