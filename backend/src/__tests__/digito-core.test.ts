import { describe, expect, it } from 'vitest';
import type { ProcessoDigito } from '../shared/types';
import {
  FLAGS, PESOS_PRIORIDADE_PADRAO,
  calcularDiasParados, calcularPontuacao, classificarPrioridade,
  detectarMetas, distribuirPorServidor, extrairDigito,
  montarMapaAtribuicoes, ordenarPorPrioridade, selecionarTarefas,
} from '../modules/pje-download/services/planilha-digito/digito-core';
import { extrairDataMovimento } from '../modules/pje-download/services/planilha-digito/planilha-digito.service';

const PESOS = PESOS_PRIORIDADE_PADRAO;

function procBase(overrides: Partial<ProcessoDigito> = {}): ProcessoDigito {
  return {
    idProcesso: 1, numeroProcesso: '8001732-90.2023.8.05.0216',
    digito: 2, anoCnj: 2023, tarefaAtual: 'Tarefa X', outrasTarefas: [],
    etiquetas: [], assuntoPrincipal: 'Assunto', diasParados: 0,
    metas: [], prioridade: 'P4', pontuacao: 0, flags: [],
    ...overrides,
  };
}

describe('extrairDigito', () => {
  it('extrai o último algarismo do sequencial, não o dígito verificador', () => {
    expect(extrairDigito('8001732-90.2023.8.05.0216')).toEqual({ digito: 2, ano: 2023 });
    expect(extrairDigito('8000839-02.2023.8.05.0216')).toEqual({ digito: 9, ano: 2023 });
    expect(extrairDigito('0000613-27.2009.8.05.0216')).toEqual({ digito: 3, ano: 2009 });
  });

  it('aceita número sem máscara (20 dígitos)', () => {
    expect(extrairDigito('80017329020238050216')).toEqual({ digito: 2, ano: 2023 });
  });

  it('retorna null para números malformados sem lançar erro', () => {
    expect(extrairDigito('')).toEqual({ digito: null, ano: null });
    expect(extrairDigito('123')).toEqual({ digito: null, ano: null });
    expect(extrairDigito('processo inválido')).toEqual({ digito: null, ano: null });
    expect(extrairDigito('8001732-90.2023')).toEqual({ digito: null, ano: null });
  });
});

describe('montarMapaAtribuicoes', () => {
  it('indexa dígito → servidor e permite servidor com vários dígitos', () => {
    const mapa = montarMapaAtribuicoes([
      { digito: 0, servidor: 'Abel' },
      { digito: 2, servidor: 'Abel' },
      { digito: 7, servidor: 'Jackmara' },
    ]);
    expect(mapa.get(0)).toBe('Abel');
    expect(mapa.get(2)).toBe('Abel');
    expect(mapa.get(7)).toBe('Jackmara');
    expect(mapa.has(5)).toBe(false);
  });

  it('descarta entradas inválidas (dígito fora de 0-9, servidor vazio)', () => {
    const mapa = montarMapaAtribuicoes([
      { digito: 10, servidor: 'X' },
      { digito: -1, servidor: 'Y' },
      { digito: 3, servidor: '   ' },
      { digito: 1.5, servidor: 'Z' },
      { digito: 4, servidor: ' Eneida ' },
    ]);
    expect([...mapa.entries()]).toEqual([[4, 'Eneida']]);
  });
});

describe('selecionarTarefas', () => {
  it('exclui as ignoradas sem sensibilidade a acento/caixa', () => {
    const todas = ['Minutar decisão', 'Verificar providência a adotar', 'Imprimir Expediente'];
    expect(selecionarTarefas(todas, ['minutar DECISAO'])).toEqual([
      'Verificar providência a adotar', 'Imprimir Expediente',
    ]);
  });

  it('sem ignoradas, mantém todas', () => {
    expect(selecionarTarefas(['A', 'B'])).toEqual(['A', 'B']);
  });
});

describe('calcularDiasParados', () => {
  const agora = new Date('2026-09-04T12:00:00Z');
  it('calcula dias corridos desde a última movimentação', () => {
    expect(calcularDiasParados('2026-08-25T12:00:00Z', agora)).toBe(10);
    expect(calcularDiasParados('2026-09-04T09:00:00Z', agora)).toBe(0);
  });
  it('data ausente ou inválida vira null (não derruba o lote)', () => {
    expect(calcularDiasParados(undefined, agora)).toBeNull();
    expect(calcularDiasParados('not-a-date', agora)).toBeNull();
  });
});

describe('detectarMetas / pontuação', () => {
  it('detecta etiquetas de meta pelos prefixos, ignorando acento/caixa', () => {
    const metas = detectarMetas(['GAB_Meta_saude', 'CCV_Abel_2', 'ACV_Meta 2'], PESOS);
    expect(metas).toEqual(['GAB_Meta_saude', 'ACV_Meta 2']);
  });

  it('saúde pesa mais que júri, saneamento e metas genéricas', () => {
    const ano = 2026;
    const p = (metas: string[]) => calcularPontuacao({ metas, diasParados: 0, anoCnj: ano }, PESOS, ano);
    expect(p(['GAB_Meta_saude'])).toBeGreaterThan(p(['GAB_Meta_juri']));
    expect(p(['GAB_Meta_juri'])).toBeGreaterThan(p(['GAB_Meta_saneamento']));
    expect(p(['GAB_Meta_saneamento'])).toBeGreaterThan(p(['GAB_Meta_2']));
    expect(p([])).toBe(0);
  });

  it('usa a meta mais pesada quando há várias (não soma)', () => {
    const ano = 2026;
    const soSaude = calcularPontuacao({ metas: ['GAB_Meta_saude'], diasParados: 0, anoCnj: ano }, PESOS, ano);
    const varias = calcularPontuacao({ metas: ['GAB_Meta_saude', 'GAB_Meta_2'], diasParados: 0, anoCnj: ano }, PESOS, ano);
    expect(varias).toBe(soSaude);
  });

  it('tempo morto entra na régua de 100 dias e escala com teto', () => {
    const ano = 2026;
    const p = (dias: number) => calcularPontuacao({ metas: [], diasParados: dias, anoCnj: ano }, PESOS, ano);
    expect(p(99)).toBe(0);
    expect(p(100)).toBe(PESOS.pesoTempoMorto);
    expect(p(130)).toBe(PESOS.pesoTempoMorto + PESOS.pesoPor30DiasAdicionais);
    // escalada limitada pelo teto
    expect(p(10_000)).toBe(PESOS.pesoTempoMorto + PESOS.tetoEscaladaTempoMorto);
  });

  it('antiguidade (Meta 2) soma por ano com teto', () => {
    const p = (anoCnj: number | null) => calcularPontuacao({ metas: [], diasParados: 0, anoCnj }, PESOS, 2026);
    expect(p(2026)).toBe(0);
    expect(p(2021)).toBe(5 * PESOS.pesoPorAnoAntiguidade);
    expect(p(1990)).toBe(PESOS.tetoAntiguidade);
    expect(p(null)).toBe(0);
  });
});

describe('classificarPrioridade', () => {
  it('P1 = meta + tempo morto; P2 = meta; P3 = tempo morto; P4 = normal', () => {
    expect(classificarPrioridade({ metas: ['GAB_Meta_2'], diasParados: 150 }, PESOS)).toBe('P1');
    expect(classificarPrioridade({ metas: ['GAB_Meta_2'], diasParados: 5 }, PESOS)).toBe('P2');
    expect(classificarPrioridade({ metas: [], diasParados: 120 }, PESOS)).toBe('P3');
    expect(classificarPrioridade({ metas: [], diasParados: 30 }, PESOS)).toBe('P4');
    expect(classificarPrioridade({ metas: [], diasParados: null }, PESOS)).toBe('P4');
  });
});

describe('ordenarPorPrioridade', () => {
  it('ordena por pontuação desc com desempate por dias parados e número', () => {
    const a = procBase({ numeroProcesso: 'A', pontuacao: 10, diasParados: 5 });
    const b = procBase({ numeroProcesso: 'B', pontuacao: 50, diasParados: 0 });
    const c = procBase({ numeroProcesso: 'C', pontuacao: 10, diasParados: 90 });
    const d = procBase({ numeroProcesso: 'D', pontuacao: 10, diasParados: 5 });
    const ordenado = ordenarPorPrioridade([a, b, c, d]).map((p) => p.numeroProcesso);
    expect(ordenado).toEqual(['B', 'C', 'A', 'D']);
  });

  it('não muta o array original', () => {
    const lista = [procBase({ pontuacao: 1 }), procBase({ pontuacao: 9 })];
    ordenarPorPrioridade(lista);
    expect(lista[0].pontuacao).toBe(1);
  });
});

describe('distribuirPorServidor', () => {
  const mapa = montarMapaAtribuicoes([
    { digito: 2, servidor: 'Abel' },
    { digito: 9, servidor: 'Terezinha' },
  ]);

  it('agrupa pelo dígito e manda dígito sem servidor para não atribuídos', () => {
    const p2 = procBase({ digito: 2, etiquetas: ['CCV_Abel_2'] });
    const p9 = procBase({ digito: 9, numeroProcesso: 'X', etiquetas: ['CCV_Terezinha'] });
    const p5 = procBase({ digito: 5, numeroProcesso: 'Y' });
    const { porServidor, naoAtribuidos } = distribuirPorServidor([p2, p9, p5], mapa);
    expect(porServidor.get('Abel')).toHaveLength(1);
    expect(porServidor.get('Terezinha')).toHaveLength(1);
    expect(naoAtribuidos).toEqual([p5]);
    expect(p2.servidor).toBe('Abel');
  });

  it('flagra número malformado nos não atribuídos', () => {
    const ruim = procBase({ digito: null, numeroProcesso: 'inválido' });
    const { naoAtribuidos } = distribuirPorServidor([ruim], mapa);
    expect(naoAtribuidos[0].flags).toContain(FLAGS.NUMERO_MALFORMADO);
  });

  it('flagra processo atribuído sem a etiqueta do seu servidor', () => {
    const semEtiqueta = procBase({ digito: 2, etiquetas: ['GAB_Meta_2'] });
    distribuirPorServidor([semEtiqueta], mapa);
    expect(semEtiqueta.flags).toContain(FLAGS.SEM_ETIQUETA_SERVIDOR);
  });

  it('flagra divergência quando a etiqueta aponta para outro servidor da atribuição', () => {
    const divergente = procBase({ digito: 9, etiquetas: ['CCV_Abel_2'] });
    distribuirPorServidor([divergente], mapa);
    expect(divergente.flags).toContain(FLAGS.ETIQUETA_DIVERGENTE);
    expect(divergente.flags).toContain(FLAGS.SEM_ETIQUETA_SERVIDOR);
    expect(divergente.servidor).toBe('Terezinha');
  });
});

describe('extrairDataMovimento', () => {
  it('lê o payload em formatos comuns sem depender do contrato exato', () => {
    expect(extrairDataMovimento({ dataMovimento: '2026-08-01T00:00:00-03:00' })).toBe('2026-08-01T00:00:00-03:00');
    expect(extrairDataMovimento({ data: '2026-08-01' })).toBe('2026-08-01');
    expect(extrairDataMovimento([{ dataHora: '2026-08-01T10:00:00Z' }])).toBe('2026-08-01T10:00:00Z');
    expect(extrairDataMovimento('2026-08-01T10:00:00Z')).toBe('2026-08-01T10:00:00Z');
  });

  it('retorna undefined para payloads sem data', () => {
    expect(extrairDataMovimento(null)).toBeUndefined();
    expect(extrairDataMovimento({})).toBeUndefined();
    expect(extrairDataMovimento('sem data aqui')).toBeUndefined();
    expect(extrairDataMovimento([])).toBeUndefined();
  });
});
