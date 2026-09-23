import { describe, expect, it } from 'vitest';
import type { ProcessoDigito } from '../shared/types';
import {
  CONFIG_PESO_PADRAO, FLAGS,
  avaliarProcesso, calcularBlocoB, calcularBlocoC, calcularBlocoE,
  calcularDiasParados, classificarSituacao, distribuirPorServidor, flagsValidacaoBi,
  extrairDigito, metasDoProcesso, montarMapaAtribuicoes, normalizarMeta,
  ordenarPorDiasParados, parseDataPje, selecionarTarefas,
  type DadosAvaliacao,
  montarMapaEtiquetas, planejarEtiquetagem,
} from '../modules/pje-download/services/planilha-digito/digito-core';
import { extrairDataMovimento } from '../modules/pje-download/services/planilha-digito/planilha-digito.service';
import { chaveConfigDigito, validarConfigDigito } from '../modules/pje-download/services/planilha-digito/digito-config-core';

const CONFIG = CONFIG_PESO_PADRAO;
const SEM_METAS = new Map<string, number>();

function avaliar(dados: Partial<DadosAvaliacao>, metasRestantes = SEM_METAS) {
  return avaliarProcesso({
    metas: [], etiquetas: [], diasParados: 0, anoCnj: 2026, tarefas: ['Tarefa comum'],
    assuntoPrincipal: 'Assunto qualquer',
    ...dados,
  }, metasRestantes, CONFIG);
}

function procBase(overrides: Partial<ProcessoDigito> = {}): ProcessoDigito {
  return {
    idProcesso: 1, numeroProcesso: '8001732-90.2023.8.05.0216',
    digito: 2, anoCnj: 2023, tarefaAtual: 'Tarefa X', outrasTarefas: [],
    etiquetas: [], assuntoPrincipal: 'Assunto', diasParados: 0,
    metas: [], metaAUmPasso: false, situacao: 'TRABALHAVEL', bloqueado: false,
    prioridade: 'P3', pontuacao: 0, faixa: 'NORMAL',
    blocos: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 1 }, flags: [], providencias: [],
    ...overrides,
  };
}

describe('extrairDigito', () => {
  it('extrai o último algarismo do sequencial, não o dígito verificador', () => {
    expect(extrairDigito('8001732-90.2023.8.05.0216')).toEqual({ digito: 2, ano: 2023 });
    expect(extrairDigito('8001229-69.2023.8.05.0216')).toEqual({ digito: 9, ano: 2023 });
    expect(extrairDigito('0000613-27.2009.8.05.0216')).toEqual({ digito: 3, ano: 2009 });
  });

  it('modo verificador usa o 1º ou o 2º algarismo depois do hífen', () => {
    expect(extrairDigito('8001732-90.2023.8.05.0216', 'verificador1').digito).toBe(9);
    expect(extrairDigito('8001732-90.2023.8.05.0216', 'verificador2').digito).toBe(0);
    expect(extrairDigito('80017329020238050216', 'verificador2').digito).toBe(0);
  });

  it('aceita número sem máscara e rejeita malformados sem lançar erro', () => {
    expect(extrairDigito('80017329020238050216')).toEqual({ digito: 2, ano: 2023 });
    expect(extrairDigito('')).toEqual({ digito: null, ano: null });
    expect(extrairDigito('processo inválido')).toEqual({ digito: null, ano: null });
  });
});

describe('montarMapaAtribuicoes / selecionarTarefas', () => {
  it('indexa dígito → servidor e descarta entradas inválidas', () => {
    const mapa = montarMapaAtribuicoes([
      { digito: 0, servidor: 'Abel' },
      { digito: 2, servidor: 'Abel' },
      { digito: 10, servidor: 'X' },
      { digito: 3, servidor: '  ' },
    ]);
    expect([...mapa.entries()]).toEqual([[0, 'Abel'], [2, 'Abel']]);
  });

  it('une o mesmo servidor sem distinção de caixa e acento', () => {
    const mapa = montarMapaAtribuicoes([
      { digito: 0, servidor: 'Abel' },
      { digito: 2, servidor: 'ABEL' },
      { digito: 4, servidor: ' ábel ' },
    ]);
    expect([...mapa.entries()]).toEqual([[0, 'Abel'], [2, 'Abel'], [4, 'Abel']]);
  });

  it('exclui tarefas ignoradas sem sensibilidade a acento/caixa', () => {
    expect(selecionarTarefas(['Minutar decisão', 'Imprimir Expediente'], ['minutar DECISAO']))
      .toEqual(['Imprimir Expediente']);
  });
});

describe('parseDataPje / calcularDiasParados', () => {
  const agora = new Date('2026-09-04T12:00:00Z');

  it('aceita epoch (ms e s), ISO com offset "+0000" e dd/MM/yyyy', () => {
    expect(parseDataPje(1756684800000)).toBe('2025-09-01T00:00:00.000Z');
    expect(parseDataPje(1756684800)).toBe('2025-09-01T00:00:00.000Z');
    expect(parseDataPje('2014-09-12T23:26:35.290+0000')).toBe('2014-09-12T23:26:35.290+0000');
    expect(parseDataPje('04/09/2026 10:30')).toBe('2026-09-04T10:30:00');
  });

  it('rejeita valores sem data', () => {
    expect(parseDataPje(undefined)).toBeUndefined();
    expect(parseDataPje('sem data')).toBeUndefined();
    expect(parseDataPje('<html>login</html>')).toBeUndefined();
    expect(parseDataPje(0)).toBeUndefined();
  });

  it('calcula dias corridos e devolve null para data ausente/ inválida', () => {
    expect(calcularDiasParados('2026-08-25T12:00:00Z', agora)).toBe(10);
    expect(calcularDiasParados(undefined, agora)).toBeNull();
    expect(calcularDiasParados('not-a-date', agora)).toBeNull();
  });
});

describe('extrairDataMovimento', () => {
  it('lê epoch no topo, campo conhecido, aninhado e ISO direto', () => {
    expect(extrairDataMovimento(1756684800000)).toBe('2025-09-01T00:00:00.000Z');
    expect(extrairDataMovimento({ dataHora: 1756684800000 })).toBe('2025-09-01T00:00:00.000Z');
    expect(extrairDataMovimento({ movimento: { dataMovimento: '2026-08-01' } })).toBe('2026-08-01');
    expect(extrairDataMovimento('2026-08-01T10:00:00Z')).toBe('2026-08-01T10:00:00Z');
  });

  it('retorna undefined para payloads sem data (inclusive HTML de erro)', () => {
    expect(extrairDataMovimento({})).toBeUndefined();
    expect(extrairDataMovimento('<html><body>login.seam</body></html>')).toBeUndefined();
  });
});

describe('metas — normalização', () => {
  it('GAB_Meta_x e "ACV_Meta x" são a mesma meta canônica', () => {
    expect(normalizarMeta('GAB_Meta_saude', CONFIG)).toBe('saude');
    expect(normalizarMeta('ACV_Meta saude', CONFIG)).toBe('saude');
    expect(normalizarMeta('GAB_Meta_2', CONFIG)).toBe('2');
    expect(normalizarMeta('CCV_Abel_2', CONFIG)).toBeNull();
    expect(metasDoProcesso(['GAB_Meta_saude', 'ACV_Meta saude', 'CCV_Abel_2'], CONFIG)).toEqual(['saude']);
  });
});

describe('bloco B — assunto e classe', () => {
  it('classifica pelos grupos em ordem decrescente', () => {
    expect(calcularBlocoB('Fornecimento de insumos', undefined, CONFIG)).toEqual({ pontos: 20, grupo: 'B1' });
    expect(calcularBlocoB('Violação dos Princípios Administrativos', undefined, CONFIG)).toEqual({ pontos: 16, grupo: 'B2' });
    expect(calcularBlocoB('Investigação de Paternidade', undefined, CONFIG)).toEqual({ pontos: 14, grupo: 'B3' });
    expect(calcularBlocoB('Inclusão Indevida em Cadastro de Inadimplentes', undefined, CONFIG)).toEqual({ pontos: 11, grupo: 'B4' });
    expect(calcularBlocoB('Indenização por Dano Moral', undefined, CONFIG)).toEqual({ pontos: 6, grupo: 'B5' });
    expect(calcularBlocoB('ICMS/Importação', undefined, CONFIG)).toEqual({ pontos: 4, grupo: 'B6' });
    expect(calcularBlocoB(undefined, undefined, CONFIG)).toEqual({ pontos: 0, grupo: null });
  });

  it('usa a classe quando o assunto não pontua', () => {
    expect(calcularBlocoB('Assunto genérico', 'ExFis', CONFIG).grupo).toBe('B6');
  });
});

describe('bloco C — tempo', () => {
  const c = (dias: number | null, ano: number | null) => calcularBlocoC(dias, ano, CONFIG);
  it('faixas de dias parados + bônus de antiguidade com teto 25', () => {
    expect(c(20, 2026)).toBe(0);
    expect(c(45, 2026)).toBe(4);
    expect(c(80, 2026)).toBe(9);
    expect(c(110, 2026)).toBe(16);
    expect(c(130, 2026)).toBe(20);
    expect(c(130, 2018)).toBe(25);   // 20 + 5, teto
    expect(c(12, 2023)).toBe(1);     // 0 + bônus 2023-2024
    expect(c(3, 2009)).toBe(5);
    expect(c(null, 2025)).toBe(0);
  });
});

describe('situação e bloco E', () => {
  it('fila de espera detectada por padrão de tarefa', () => {
    expect(classificarSituacao(['Aguardar decurso de prazo'], CONFIG)).toBe('FILA_ESPERA');
    expect(classificarSituacao(['(SUSP) Processo Suspenso por Recursos Repetitivos'], CONFIG)).toBe('FILA_ESPERA');
    expect(classificarSituacao(['Aguardando apreciação pela instância superior'], CONFIG)).toBe('FILA_ESPERA');
    expect(classificarSituacao(['Processo com prazo em curso'], CONFIG)).toBe('TRABALHAVEL');
    // trabalhável em uma tarefa e em fila em outra → trabalhável
    expect(classificarSituacao(['[E-CARTA] Aguardar resposta dos Correios', 'Imprimir Expediente'], CONFIG)).toBe('TRABALHAVEL');
  });

  it('pontua a proximidade da baixa pela melhor tarefa trabalhável', () => {
    expect(calcularBlocoE(['Certificar decurso'], 'TRABALHAVEL', CONFIG)).toBe(10);
    expect(calcularBlocoE(['Imprimir Expediente'], 'TRABALHAVEL', CONFIG)).toBe(6);
    expect(calcularBlocoE(['Cumprir determinações - URGENTES'], 'TRABALHAVEL', CONFIG)).toBe(6);
    expect(calcularBlocoE(['Verificar providência a adotar'], 'TRABALHAVEL', CONFIG)).toBe(3);
    expect(calcularBlocoE(['Processo com prazo em curso'], 'TRABALHAVEL', CONFIG)).toBe(0);
    expect(calcularBlocoE(['Certificar decurso'], 'FILA_ESPERA', CONFIG)).toBe(0);
  });
});

describe('avaliarProcesso — exemplos calculados do DOC_Peso §7', () => {
  it('8001732: Meta saúde a um passo, insumos, 12 dias → peso 61, ALTO, P2', () => {
    const r = avaliar({
      metas: ['saude'], etiquetas: ['CCV_Abel', 'GAB_Meta_saude'],
      assuntoPrincipal: 'Fornecimento de insumos',
      diasParados: 12, anoCnj: 2023, tarefas: ['Processo com prazo em curso'],
    }, new Map([['saude', 2]]));
    expect(r.blocos).toEqual({ A: 40, B: 20, C: 1, D: 0, E: 0, F: 1 });
    expect(r.peso).toBe(61);
    expect(r.faixa).toBe('ALTO');
    expect(r.prioridade).toBe('P2');
    expect(r.metaAUmPasso).toBe(true);
  });

  it('8001142: Meta saúde com assunto errado, em fila → peso 18 e ASSUNTO_REVISAR', () => {
    const r = avaliar({
      metas: ['saude'], etiquetas: ['GAB_Meta_saude'],
      assuntoPrincipal: 'Reajuste contratual',
      diasParados: 1, anoCnj: 2016, tarefas: ['Aguardar decurso de prazo'],
    }, new Map([['saude', 2]]));
    expect(r.situacao).toBe('FILA_ESPERA');
    expect(r.flags).toContain(FLAGS.ASSUNTO_REVISAR);
    expect(r.blocos).toEqual({ A: 40, B: 6, C: 5, D: 8, E: 0, F: 0.3 });
    expect(r.peso).toBe(18);
  });

  it('0000613: improbidade a um passo, 2009 → peso 64, ALTO', () => {
    const r = avaliar({
      metas: ['improbidade'], etiquetas: ['GAB_Meta_improbidade'],
      assuntoPrincipal: 'Violação dos Princípios Administrativos',
      diasParados: 3, anoCnj: 2009, tarefas: ['Verificar providência a adotar'],
    }, new Map([['improbidade', 2]]));
    expect(r.blocos).toEqual({ A: 40, B: 16, C: 5, D: 0, E: 3, F: 1 });
    expect(r.peso).toBe(64);
    expect(r.faixa).toBe('ALTO');
  });

  it('hipotético: Certificar decurso, Meta 2, 2018, 130 dias, Contratos Bancários → peso 67', () => {
    const r = avaliar({
      metas: ['2'], etiquetas: ['ACV_Meta 2'],
      assuntoPrincipal: 'Contratos Bancários',
      diasParados: 130, anoCnj: 2018, tarefas: ['Certificar decurso'],
    }, new Map([['2', 50]]));
    expect(r.blocos).toEqual({ A: 26, B: 6, C: 25, D: 0, E: 10, F: 1 });
    expect(r.peso).toBe(67);
    expect(r.prioridade).toBe('P1');
    expect(r.flags).toContain(FLAGS.TEMPO_MORTO_INTERNO);
  });

  it('processo comum sem etiqueta CCV → peso 6, NORMAL, P3 (a flag não pontua nem gera providência)', () => {
    const r = avaliar({
      assuntoPrincipal: 'Indenização por Dano Moral',
      diasParados: 20, anoCnj: 2025, tarefas: ['Processo com prazo em curso'],
      flagsBase: [FLAGS.SEM_ETIQUETA_DIGITO],
    });
    expect(r.blocos).toEqual({ A: 0, B: 6, C: 0, D: 0, E: 0, F: 1 });
    expect(r.peso).toBe(6);
    expect(r.flags).toContain(FLAGS.SEM_ETIQUETA_DIGITO);
    expect(flagsValidacaoBi(r.flags)).not.toContain(FLAGS.SEM_ETIQUETA_DIGITO);
    expect(r.providencias).toEqual([]);
    expect(r.faixa).toBe('NORMAL');
    expect(r.prioridade).toBe('P3');
  });

  it('prioridade: > 30 dias é P1 mesmo sem meta; meta recente é P2; resto é P3', () => {
    expect(avaliar({ diasParados: 31 }).prioridade).toBe('P1');
    expect(avaliar({ diasParados: 31, metas: ['saude'], etiquetas: ['GAB_Meta_saude'] }).prioridade).toBe('P1');
    expect(avaliar({ diasParados: 30, metas: ['saude'], etiquetas: ['GAB_Meta_saude'] }).prioridade).toBe('P2');
    expect(avaliar({ diasParados: 30 }).prioridade).toBe('P3');
    expect(avaliar({ diasParados: null }).prioridade).toBe('P3');
  });

  it('GAB_nao trabalhar não pontua como GAB e marca BLOQUEADO', () => {
    const r = avaliar({ etiquetas: ['GAB_nao trabalhar'] });
    expect(r.blocos.A).toBe(0);
    expect(r.bloqueado).toBe(true);
    expect(r.flags).toContain(FLAGS.BLOQUEADO);
  });

  it('etiqueta GAB sem meta vale 12 (P2); duas metas ganham bônus', () => {
    expect(avaliar({ etiquetas: ['GAB_revisar custas'] }).blocos.A).toBe(12);
    expect(avaliar({ etiquetas: ['GAB_revisar custas'] }).prioridade).toBe('P2');
    // saúde 36 + bônus 5 = 41, recortado no teto do bloco (min(A+5, 40) — §3.1)
    const duas = avaliar({ metas: ['saude', '2'], etiquetas: ['GAB_Meta_saude', 'ACV_Meta 2'] });
    expect(duas.blocos.A).toBe(40);
    const duasMenores = avaliar({ metas: ['saneamento', '2'], etiquetas: ['GAB_Meta_saneamento', 'ACV_Meta 2'] });
    expect(duasMenores.blocos.A).toBe(26 + 5);
  });

  it('FILA_META_100D: meta em fila de espera acima da régua CNJ', () => {
    const r = avaliar({
      metas: ['2'], etiquetas: ['GAB_Meta_2'], diasParados: 150,
      tarefas: ['Aguardando apreciação pela instância superior'],
    });
    expect(r.flags).toContain(FLAGS.FILA_META_100D);
    expect(r.blocos.D).toBe(10);
  });
});

describe('ordenarPorDiasParados', () => {
  it('mais dias parados primeiro, ignorando prioridade e peso', () => {
    const a = procBase({ numeroProcesso: 'A', prioridade: 'P2', pontuacao: 90, diasParados: 5, metas: ['saude'] });
    const b = procBase({ numeroProcesso: 'B', prioridade: 'P1', pontuacao: 10, diasParados: 90 });
    const c = procBase({ numeroProcesso: 'C', prioridade: 'P3', pontuacao: 0, diasParados: 40 });
    const semData = procBase({ numeroProcesso: 'D', diasParados: null });
    expect(ordenarPorDiasParados([a, semData, c, b]).map((p) => p.numeroProcesso)).toEqual(['B', 'C', 'A', 'D']);
  });

  it('empate nos dias: processo de meta vem antes; depois peso desc, ano asc, número', () => {
    const comum = procBase({ numeroProcesso: 'A', pontuacao: 80, diasParados: 40, anoCnj: 2010 });
    const meta = procBase({ numeroProcesso: 'B', pontuacao: 10, diasParados: 40, anoCnj: 2024, metas: ['2'] });
    const comumAntigo = procBase({ numeroProcesso: 'C', pontuacao: 80, diasParados: 40, anoCnj: 2005 });
    expect(ordenarPorDiasParados([comum, meta, comumAntigo]).map((p) => p.numeroProcesso)).toEqual(['B', 'C', 'A']);
  });
});

describe('distribuirPorServidor', () => {
  const mapa = montarMapaAtribuicoes([
    { digito: 2, servidor: 'Abel' },
    { digito: 9, servidor: 'Terezinha' },
  ]);

  it('agrupa pelo dígito, manda dígito sem servidor para não atribuídos e audita etiquetas', () => {
    const p2 = procBase({ digito: 2, etiquetas: ['CCV_Abel_2'] });
    const semEtiqueta = procBase({ digito: 2, numeroProcesso: 'X', etiquetas: ['GAB_Meta_2'] });
    const divergente = procBase({ digito: 9, numeroProcesso: 'Y', etiquetas: ['CCV_Abel_2'] });
    const semServidor = procBase({ digito: 5, numeroProcesso: 'Z' });
    const malformado = procBase({ digito: null, numeroProcesso: 'inválido' });

    const { porServidor, naoAtribuidos } = distribuirPorServidor(
      [p2, semEtiqueta, divergente, semServidor, malformado], mapa,
    );
    expect(porServidor.get('Abel')).toHaveLength(2);
    expect(p2.flags).toEqual([]);
    expect(semEtiqueta.flags).toContain(FLAGS.SEM_ETIQUETA_DIGITO);
    expect(divergente.flags).toContain(FLAGS.DIGITO_DIVERGENTE);
    expect(divergente.servidor).toBe('Terezinha');
    expect(naoAtribuidos.map((p) => p.numeroProcesso)).toEqual(['Z', 'inválido']);
    expect(malformado.flags).toContain(FLAGS.NUMERO_MALFORMADO);
  });
});

describe('etiquetagem por dígito', () => {
  const mapa = montarMapaAtribuicoes([
    { digito: 2, servidor: 'Abel' },
    { digito: 9, servidor: 'Terezinha' },
    { digito: 4, servidor: 'Carol' },
  ]);
  const etiquetas = montarMapaEtiquetas(undefined, mapa, [
    { servidor: 'Abel', etiqueta: { id: 10, nome: 'CCV_Abel' } },
    { servidor: 'Terezinha', etiqueta: { id: 20, nome: 'CCV_Terezinha' } },
    { servidor: 'Fulano', etiqueta: { id: 30, nome: 'CCV_Fulano' } },
    { servidor: 'Carol', etiqueta: { id: 0, nome: '' } },
  ]);

  it('só guarda etiquetas válidas de servidores presentes na atribuição', () => {
    expect([...etiquetas.entries()]).toEqual([[2, { id: 10, nome: 'CCV_Abel' }], [9, { id: 20, nome: 'CCV_Terezinha' }]]);
  });

  it('com etiqueta vinculada a auditoria compara o nome exato', () => {
    const exato = procBase({ digito: 2, etiquetas: ['ccv_abel'] });
    const parecido = procBase({ digito: 2, numeroProcesso: 'X', etiquetas: ['CCV_Abel_2'] });
    distribuirPorServidor([exato, parecido], mapa, etiquetas);
    expect(exato.flags).toEqual([]);
    expect(parecido.flags).toContain(FLAGS.SEM_ETIQUETA_DIGITO);
  });

  it('planeja inserir a etiqueta do servidor e remover a dos demais, ignorando servidor sem etiqueta', () => {
    const semNada = procBase({ idProcesso: 1, numeroProcesso: 'A', digito: 2, etiquetas: ['GAB_Meta_2'] });
    const jaCerto = procBase({ idProcesso: 2, numeroProcesso: 'B', digito: 2, etiquetas: ['CCV_Abel'] });
    const trocado = procBase({ idProcesso: 3, numeroProcesso: 'C', digito: 9, etiquetas: ['CCV_Abel'] });
    const deCarol = procBase({ idProcesso: 4, numeroProcesso: 'D', digito: 4, etiquetas: ['CCV_Abel'] });
    const { porServidor } = distribuirPorServidor([semNada, jaCerto, trocado, deCarol], mapa, etiquetas);

    const plano = planejarEtiquetagem(porServidor, etiquetas);
    expect(plano.map((i) => i.numeroProcesso)).toEqual(['A', 'C']);
    expect(plano[0]).toMatchObject({ servidor: 'Abel', inserir: { id: 10 }, remover: [] });
    expect(plano[1]).toMatchObject({ servidor: 'Terezinha', inserir: { id: 20 }, remover: [{ id: 10 }] });
  });
});

describe('etiqueta por dígito — mesmo servidor com duas etiquetas', () => {
  const atribuicoes = [
    { digito: 0, servidor: 'Abel', etiqueta: { id: 49, nome: 'CCV_Abel_0' } },
    { digito: 2, servidor: 'ABEL', etiqueta: { id: 53, nome: 'CCV_Abel_2' } },
    { digito: 5, servidor: 'Carol', etiqueta: { id: 49, nome: 'CCV_Abel_0' } },
  ];
  const mapa = montarMapaAtribuicoes(atribuicoes);
  const etiquetas = montarMapaEtiquetas(atribuicoes, mapa);

  it('vincula a etiqueta de cada dígito e recusa etiqueta já usada por outro servidor', () => {
    expect([...etiquetas.entries()]).toEqual([[0, { id: 49, nome: 'CCV_Abel_0' }], [2, { id: 53, nome: 'CCV_Abel_2' }]]);
  });

  it('agrupa os dois dígitos na mesma planilha e aplica a etiqueta do dígito do processo', () => {
    const d0 = procBase({ idProcesso: 1, numeroProcesso: 'A', digito: 0, etiquetas: [] });
    const d2 = procBase({ idProcesso: 2, numeroProcesso: 'B', digito: 2, etiquetas: ['CCV_Abel_0'] });
    const d2ok = procBase({ idProcesso: 3, numeroProcesso: 'C', digito: 2, etiquetas: ['CCV_Abel_2', 'CCV_Abel'] });
    const { porServidor } = distribuirPorServidor([d0, d2, d2ok], mapa, etiquetas);

    expect([...porServidor.keys()]).toEqual(['Abel', 'Carol']);
    expect(porServidor.get('Abel')).toHaveLength(3);
    expect(d2.flags).toEqual(expect.arrayContaining([FLAGS.SEM_ETIQUETA_DIGITO, FLAGS.DIGITO_DIVERGENTE]));
    expect(d2ok.flags).toEqual([]);

    const plano = planejarEtiquetagem(porServidor, etiquetas);
    expect(plano).toEqual([
      { idProcesso: 1, numeroProcesso: 'A', servidor: 'Abel', inserir: { id: 49, nome: 'CCV_Abel_0' }, remover: [] },
      { idProcesso: 2, numeroProcesso: 'B', servidor: 'Abel', inserir: { id: 53, nome: 'CCV_Abel_2' }, remover: [{ id: 49, nome: 'CCV_Abel_0' }] },
    ]);
  });

  it('mesma etiqueta em dígitos do mesmo servidor não é removida entre eles', () => {
    const atrib = [
      { digito: 1, servidor: 'Ana', etiqueta: { id: 7, nome: 'CCV_Ana' } },
      { digito: 3, servidor: 'ana', etiqueta: { id: 7, nome: 'CCV_Ana' } },
    ];
    const m = montarMapaAtribuicoes(atrib);
    const e = montarMapaEtiquetas(atrib, m);
    const p = procBase({ digito: 3, etiquetas: ['CCV_Ana'] });
    const { porServidor } = distribuirPorServidor([p], m, e);
    expect(p.flags).toEqual([]);
    expect(planejarEtiquetagem(porServidor, e)).toEqual([]);
  });
});

describe('configuração da automação por dígito', () => {
  it('normaliza servidores: dígito e etiqueta ficam com o primeiro dono, linhas vazias somem', () => {
    const { config, erros } = validarConfigDigito({
      servidores: [
        { nome: ' Abel ', digitos: [3, 1, 1, '7', 12], etiqueta: { id: 10, nome: 'CCV_Abel' } },
        { nome: 'Carol', digitos: [1, 4], etiqueta: { id: 10, nome: 'CCV_Abel' } },
        { nome: '', digitos: [] },
        { nome: 'Sem dígito', digitos: [] },
      ],
      modoDigito: 'verificador1', formato: 'zip', reduzida: true, tarefasIgnoradas: ['Análise', 'analise', ''],
    });
    expect(erros).toEqual([]);
    expect(config?.servidores).toEqual([
      { nome: 'Abel', digitos: [1, 3, 7], etiqueta: { id: 10, nome: 'CCV_Abel' } },
      { nome: 'Carol', digitos: [4] },
      { nome: 'Sem dígito', digitos: [] },
    ]);
    expect(config).toMatchObject({ modoDigito: 'verificador1', formato: 'zip', reduzida: true, tarefasIgnoradas: ['Análise'] });
    expect(config?.padroesFilaEspera).toBeUndefined();
  });

  it('guarda os termos de fila de espera sem repetição e ignora lista inválida', () => {
    const ok = validarConfigDigito({ servidores: [], padroesFilaEspera: [' (SUSP) ', '(susp)', 'Parcelamento', ''] });
    expect(ok.config?.padroesFilaEspera).toEqual(['(SUSP)', 'Parcelamento']);
    expect(validarConfigDigito({ servidores: [], padroesFilaEspera: 'x' }).erros[0]).toMatch(/padroesFilaEspera/);
  });

  it('rejeita corpo inválido e modo desconhecido', () => {
    expect(validarConfigDigito(null).erros).toHaveLength(1);
    expect(validarConfigDigito({ servidores: [], modoDigito: 'x' }).erros).toContain('modoDigito inválido.');
  });

  it('aceita o mesmo servidor em várias linhas, cada uma com sua etiqueta', () => {
    const { config, erros } = validarConfigDigito({ servidores: [
      { nome: 'Abel', digitos: [0], etiqueta: { id: 49, nome: 'CCV_Abel_0' } },
      { nome: 'ABEL', digitos: [2], etiqueta: { id: 53, nome: 'CCV_Abel_2' } },
      { nome: 'abel', digitos: [4], etiqueta: { id: 49, nome: 'CCV_Abel_0' } },
      { nome: 'Carol', digitos: [5], etiqueta: { id: 53, nome: 'CCV_Abel_2' } },
    ] });
    expect(erros).toEqual([]);
    expect(config?.servidores.map((s) => s.etiqueta?.id)).toEqual([49, 53, 49, undefined]);
  });

  it('chave é por CPF e perfil, com fallback no idUsuario', () => {
    expect(chaveConfigDigito({ cpf: '123.456.789-00', idUsuarioLocalizacao: '55' })).toBe('12345678900::55');
    expect(chaveConfigDigito({ idUsuario: 9, idUsuarioLocalizacao: '55' })).toBe('u9::55');
  });
});
