import * as path from 'node:path';
import * as fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { ConfigPeso, FaixaPeso, ModoDigito, ProcessoDigito } from '../../../../shared/types';
import { XLSX_THIN_BORDER } from '../xlsx-common';
import type { ResultadoDistribuicao } from './digito-core';
import { FLAGS, flagsValidacaoBi } from './digito-core';

const OUTPUT_DIR = path.join(process.cwd(), 'downloads', 'planilhas');
const MAX_SHEET_NAME_LEN = 31;
const INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;

// ───────────────────────── Paleta (inspirada na planilha de validação BI da unidade) ─────────────────────────

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

const COR = {
  cabecalho: 'FF1F4E78',
  secao: 'FFDDEBF7',
  totalLinha: 'FFBDD7EE',
  servidor: 'FFCFE2F3',
  trabalhaveis: 'FFE2EFDA',
  filaEspera: 'FFFFF2CC',
  cinza: 'FFD9D9D9',
  meta: 'FFD9D2E9',
  alertaFlag: 'FFF8CBAD',
  diasAlerta: 'FFF8CBAD',
  diasCritico: 'FFE06666',
  p1: 'FFF4B6B6',
  p2: 'FFFAD7A0',
  p3: 'FFD9EAD3',
  situacaoFila: 'FFCFE2F3',
  situacaoTrabalhavel: 'FFE2EFDA',
} as const;

const FONTE_BASE: Partial<ExcelJS.Font> = { name: 'Arial', size: 10 };
const FONTE_TITULO: Partial<ExcelJS.Font> = { name: 'Arial', size: 13, bold: true, color: { argb: COR.cabecalho } };
const FONTE_LEGENDA: Partial<ExcelJS.Font> = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
const FONTE_CABECALHO: Partial<ExcelJS.Font> = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };

type Prioridade = ProcessoDigito['prioridade'];

const ESTILO_PRIORIDADE: Record<Prioridade, { fill: ExcelJS.Fill; font: Partial<ExcelJS.Font>; rotulo: string }> = {
  P1: { fill: solid(COR.p1), font: { ...FONTE_BASE, bold: true, color: { argb: 'FF9C0006' } }, rotulo: 'P1 Parado' },
  P2: { fill: solid(COR.p2), font: { ...FONTE_BASE, bold: true, color: { argb: 'FF7F4F00' } }, rotulo: 'P2 GAB/Meta' },
  P3: { fill: solid(COR.p3), font: { ...FONTE_BASE, bold: true, color: { argb: 'FF375623' } }, rotulo: 'P3 Normal' },
};

const ESTILO_FAIXA: Record<FaixaPeso, { fill: ExcelJS.Fill; font: Partial<ExcelJS.Font>; rotulo: string }> = {
  CRITICO: { fill: solid('FFFFC7CE'), font: { ...FONTE_BASE, bold: true, color: { argb: 'FF9C0006' } }, rotulo: 'CRÍTICO' },
  ALTO: { fill: solid('FFFFE0B2'), font: { ...FONTE_BASE, bold: true, color: { argb: 'FF9C6500' } }, rotulo: 'ALTO' },
  MEDIO: { fill: solid('FFFFF2CC'), font: { ...FONTE_BASE, color: { argb: 'FF7F6000' } }, rotulo: 'MÉDIO' },
  NORMAL: { fill: solid('FFC6EFCE'), font: { ...FONTE_BASE, color: { argb: 'FF006100' } }, rotulo: 'NORMAL' },
};

function estiloCabecalho(cell: ExcelJS.Cell): void {
  cell.font = FONTE_CABECALHO;
  cell.fill = solid(COR.cabecalho);
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = XLSX_THIN_BORDER;
}

function estiloDado(cell: ExcelJS.Cell, fill?: ExcelJS.Fill): void {
  cell.font = FONTE_BASE;
  cell.alignment = { vertical: 'top', wrapText: true };
  cell.border = XLSX_THIN_BORDER;
  if (fill) cell.fill = fill;
}

// ───────────────────────── Abas de processos ─────────────────────────

type VarianteSheet = 'servidor' | 'fila' | 'nao_atribuidos';

interface ColunaDef { titulo: string; largura: number; valor: (p: ProcessoDigito) => string | number; }

function tarefaComExtras(p: ProcessoDigito): string {
  return p.outrasTarefas.length > 0
    ? `${p.tarefaAtual}\n+ também em: ${p.outrasTarefas.join('; ')}`
    : p.tarefaAtual;
}

function motivoNaoAtribuido(proc: ProcessoDigito): string {
  if (proc.flags.includes(FLAGS.NUMERO_MALFORMADO)) return 'Número de processo fora do padrão CNJ';
  return `Dígito ${proc.digito} sem servidor atribuído`;
}

function rotuloMeta(meta: string): string {
  return /^meta/i.test(meta) ? meta : `Meta ${meta}`;
}

function colunasBase(reduzida: boolean): ColunaDef[] {
  if (reduzida) {
    return [
      { titulo: 'Número do processo', largura: 26, valor: (p) => p.numeroProcesso },
      { titulo: 'Dígito', largura: 7, valor: (p) => p.digito ?? '—' },
      { titulo: 'Etiquetas', largura: 45, valor: (p) => p.etiquetas.join(', ') },
      { titulo: 'Dias parados', largura: 10, valor: (p) => p.diasParados ?? '—' },
    ];
  }
  return [
    { titulo: 'Número do processo', largura: 26, valor: (p) => p.numeroProcesso },
    { titulo: 'Dígito', largura: 7, valor: (p) => p.digito ?? '—' },
    { titulo: 'Tarefa atual', largura: 38, valor: tarefaComExtras },
    { titulo: 'Dias parados', largura: 10, valor: (p) => p.diasParados ?? '—' },
    { titulo: 'Etiquetas', largura: 45, valor: (p) => p.etiquetas.join(', ') },
    { titulo: 'Prioridade', largura: 10, valor: (p) => p.prioridade },
    { titulo: 'Meta afetada', largura: 18, valor: (p) => p.metas.map(rotuloMeta).join(', ') },
    { titulo: 'Peso', largura: 7, valor: (p) => p.pontuacao },
    { titulo: 'Faixa', largura: 10, valor: (p) => ESTILO_FAIXA[p.faixa].rotulo },
    { titulo: 'Validação BI', largura: 30, valor: (p) => flagsValidacaoBi(p.flags).join(', ') },
    { titulo: 'Providência', largura: 50, valor: (p) => p.providencias.join(' | ') },
    { titulo: 'Assunto', largura: 32, valor: (p) => p.assuntoPrincipal || '' },
  ];
}

function colunasDaVariante(variante: VarianteSheet, reduzida: boolean): ColunaDef[] {
  const base = colunasBase(reduzida);
  if (variante === 'fila') {
    return [{ titulo: 'Servidor', largura: 16, valor: (p) => p.servidor ?? '—' }, ...base];
  }
  if (variante === 'nao_atribuidos') {
    return [
      ...base,
      { titulo: 'Situação', largura: 14, valor: (p) => (p.situacao === 'FILA_ESPERA' ? 'Fila de espera' : 'Trabalhável') },
      { titulo: 'Motivo', largura: 34, valor: motivoNaoAtribuido },
    ];
  }
  return base;
}

function sanitizeSheetName(name: string): string {
  const base = name.replace(INVALID_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim() || 'Planilha';
  return base.length > MAX_SHEET_NAME_LEN ? base.slice(0, MAX_SHEET_NAME_LEN).trim() : base;
}

function sanitizeFileName(name: string): string {
  return (name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, '_').trim() || 'servidor').slice(0, 80);
}

interface SheetOpts {
  titulo: string;
  pesos: ConfigPeso;
  variante: VarianteSheet;
  reduzida: boolean;
}

function popularSheetDigito(ws: ExcelJS.Worksheet, processos: ProcessoDigito[], opts: SheetOpts): void {
  const colunas = colunasDaVariante(opts.variante, opts.reduzida);
  ws.columns = colunas.map((c) => ({ width: c.largura }));
  const { pesos } = opts;

  const titulo = ws.getCell(1, 1);
  titulo.value = `${opts.titulo} — ${processos.length} processo(s) — gerado em ${new Date().toLocaleDateString('pt-BR')}`;
  titulo.font = FONTE_TITULO;
  ws.mergeCells(1, 1, 1, colunas.length);

  const legenda = ws.getCell(2, 1);
  legenda.value =
    `Prioridade: P1 = parado há mais de ${pesos.limiarDiasP1} dias (com ou sem meta) · `
    + 'P2 = etiqueta de Meta/GAB · P3 = andamento normal. '
    + 'Peso = (Meta + Assunto + Tempo + Rastro BI + Proximidade da baixa) × Situação, de 0 a 100 — '
    + `CRÍTICO ≥ ${pesos.limiarCritico} · ALTO ≥ ${pesos.limiarAlto} · MÉDIO ≥ ${pesos.limiarMedio}. `
    + (opts.variante === 'fila'
      ? `Fila de espera: o cartório não pode trabalhar — acompanhar/cobrar terceiro (peso × ${pesos.multiplicadorFilaEspera}).`
      : 'Ordem: mais dias parados primeiro; em empate, processo de meta vem antes.');
  legenda.font = FONTE_LEGENDA;
  legenda.alignment = { wrapText: true, vertical: 'top' };
  ws.mergeCells(2, 1, 2, colunas.length);
  ws.getRow(2).height = 30;

  // Linha 3: legenda de cores em células coloridas (como na planilha da unidade).
  const chips: Array<{ texto: string; fill: ExcelJS.Fill; font: Partial<ExcelJS.Font> }> = [
    { texto: `${ESTILO_PRIORIDADE.P1.rotulo} >${pesos.limiarDiasP1}d`, fill: ESTILO_PRIORIDADE.P1.fill, font: ESTILO_PRIORIDADE.P1.font },
    { texto: ESTILO_PRIORIDADE.P2.rotulo, fill: ESTILO_PRIORIDADE.P2.fill, font: ESTILO_PRIORIDADE.P2.font },
    { texto: ESTILO_PRIORIDADE.P3.rotulo, fill: ESTILO_PRIORIDADE.P3.fill, font: ESTILO_PRIORIDADE.P3.font },
    { texto: `Dias: laranja >${pesos.limiarTempoMortoCnj} · vermelho >${pesos.limiarTempoMortoInterno}`, fill: solid(COR.diasAlerta), font: { ...FONTE_BASE, bold: true } },
    { texto: 'Meta afetada', fill: solid(COR.meta), font: { ...FONTE_BASE, bold: true } },
    { texto: 'Validação BI (flag)', fill: solid(COR.alertaFlag), font: { ...FONTE_BASE, bold: true } },
  ];
  chips.forEach((chip, i) => {
    if (i + 1 > colunas.length) return;
    const cell = ws.getCell(3, i + 1);
    cell.value = chip.texto;
    cell.fill = chip.fill;
    cell.font = chip.font;
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = XLSX_THIN_BORDER;
  });

  const LINHA_CABECALHO = 4;
  const headerRow = ws.getRow(LINHA_CABECALHO);
  colunas.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.titulo;
    estiloCabecalho(cell);
  });
  headerRow.height = 22;

  const idx = (titulo: string) => colunas.findIndex((c) => c.titulo === titulo) + 1;
  const idxDias = idx('Dias parados');
  const idxPrioridade = idx('Prioridade');
  const idxFaixa = idx('Faixa');
  const idxMeta = idx('Meta afetada');
  const idxFlags = idx('Validação BI');
  const idxSituacao = idx('Situação');

  processos.forEach((p, i) => {
    const row = ws.getRow(LINHA_CABECALHO + 1 + i);
    row.values = colunas.map((c) => c.valor(p));
    const tinta = ESTILO_PRIORIDADE[p.prioridade];
    row.eachCell({ includeEmpty: true }, (cell) => estiloDado(cell, tinta.fill));

    // Colunas que sobrescrevem a tinta da prioridade.
    if (typeof p.diasParados === 'number') {
      const diasCell = row.getCell(idxDias);
      if (p.diasParados > pesos.limiarTempoMortoInterno) { diasCell.fill = solid(COR.diasCritico); diasCell.font = { ...FONTE_BASE, bold: true }; }
      else if (p.diasParados > pesos.limiarTempoMortoCnj) { diasCell.fill = solid(COR.diasAlerta); diasCell.font = { ...FONTE_BASE, bold: true }; }
    }
    // Na planilha reduzida essas colunas não existem (idx 0).
    if (idxPrioridade > 0) {
      row.getCell(idxPrioridade).font = tinta.font;
      row.getCell(idxPrioridade).alignment = { horizontal: 'center', vertical: 'top' };
    }
    if (idxMeta > 0 && p.metas.length > 0) row.getCell(idxMeta).fill = solid(COR.meta);
    if (idxFlags > 0 && p.flags.length > 0) row.getCell(idxFlags).fill = solid(COR.alertaFlag);
    if (idxFaixa > 0) {
      const faixaCell = row.getCell(idxFaixa);
      faixaCell.fill = ESTILO_FAIXA[p.faixa].fill;
      faixaCell.font = ESTILO_FAIXA[p.faixa].font;
      faixaCell.alignment = { horizontal: 'center', vertical: 'top' };
    }
    if (idxSituacao > 0) {
      row.getCell(idxSituacao).fill = solid(p.situacao === 'FILA_ESPERA' ? COR.situacaoFila : COR.situacaoTrabalhavel);
    }
  });

  const ultimaLinha = LINHA_CABECALHO + processos.length;
  if (ultimaLinha > LINHA_CABECALHO) {
    ws.autoFilter = { from: { row: LINHA_CABECALHO, column: 1 }, to: { row: ultimaLinha, column: colunas.length } };
  }
  ws.views = [{ state: 'frozen', ySplit: LINHA_CABECALHO }];
}

// ───────────────────────── Aba "Resumo" ─────────────────────────

export interface DadosResumoDigito {
  distribuicao: ResultadoDistribuicao;
  digitosPorServidor: Map<string, number[]>;
  /** Meta (nome normalizado) → processos restantes no acervo analisado. */
  metasRestantes: Map<string, number>;
  pesos: ConfigPeso;
  modoDigito: ModoDigito;
}

const DESCRICAO_MODO_DIGITO: Record<ModoDigito, string> = {
  sequencial: 'último algarismo do sequencial do número CNJ (antes do hífen)',
  verificador1: '1º algarismo do verificador do número CNJ (logo após o hífen)',
  verificador2: '2º algarismo do verificador do número CNJ (após o hífen)',
};

const LARGURAS_RESUMO = [52, 18, 22, 30, 22, 60, 22, 18, 14];

function contarFlag(processos: ProcessoDigito[], flag: string): number {
  return processos.filter((p) => p.flags.includes(flag)).length;
}

function popularSheetResumo(ws: ExcelJS.Worksheet, dados: DadosResumoDigito): void {
  const { distribuicao, digitosPorServidor, metasRestantes, pesos, modoDigito } = dados;
  ws.columns = LARGURAS_RESUMO.map((width) => ({ width }));
  const NCOLS = LARGURAS_RESUMO.length;

  const atribuidos = [...distribuicao.porServidor.values()].flat();
  const todos = [...atribuidos, ...distribuicao.naoAtribuidos];
  const trabalhaveis = atribuidos.filter((p) => p.situacao === 'TRABALHAVEL');
  const filas = atribuidos.filter((p) => p.situacao === 'FILA_ESPERA');
  const naoAtribMalformados = distribuicao.naoAtribuidos.filter((p) => p.flags.includes(FLAGS.NUMERO_MALFORMADO)).length;

  let linha = 1;
  const titulo = ws.getCell(linha, 1);
  titulo.value = `PAINEL — Distribuição por dígito e validação BI · gerado em ${new Date().toLocaleDateString('pt-BR')}`;
  titulo.font = FONTE_TITULO;
  ws.mergeCells(linha, 1, linha, NCOLS);
  linha += 2;

  const secao = (texto: string) => {
    const cell = ws.getCell(linha, 1);
    cell.value = texto;
    cell.fill = solid(COR.secao);
    cell.font = { ...FONTE_BASE, bold: true };
    ws.mergeCells(linha, 1, linha, NCOLS);
    linha++;
  };

  const cabecalho = (titulos: string[]) => {
    titulos.forEach((t, i) => { const c = ws.getCell(linha, i + 1); c.value = t; estiloCabecalho(c); });
    linha++;
  };

  const linhaDado = (valores: Array<string | number>, fills: Array<string | undefined> = [], bold = false) => {
    valores.forEach((v, i) => {
      const c = ws.getCell(linha, i + 1);
      c.value = v;
      estiloDado(c, fills[i] ? solid(fills[i]!) : undefined);
      if (bold) c.font = { ...FONTE_BASE, bold: true };
      if (typeof v === 'number') c.alignment = { horizontal: 'right', vertical: 'top' };
    });
    linha++;
  };

  // 1. Totais gerais
  secao('1. Totais gerais');
  const totais: Array<[string, number]> = [
    ['Processos únicos no acervo analisado', todos.length],
    ['Total trabalhável (atribuído a servidor)', trabalhaveis.length],
    ['Total em filas de espera (atribuído a servidor)', filas.length],
    ['Não atribuídos — dígito sem servidor', distribuicao.naoAtribuidos.length - naoAtribMalformados],
    ['Não atribuídos — número fora do padrão CNJ', naoAtribMalformados],
    ['Bloqueados (GAB_nao trabalhar)', todos.filter((p) => p.bloqueado).length],
    [`Tempo morto CNJ (> ${pesos.limiarTempoMortoCnj} dias parados)`, contarFlag(todos, FLAGS.TEMPO_MORTO_CNJ)],
    [`Tempo morto interno (> ${pesos.limiarTempoMortoInterno} dias parados)`, contarFlag(todos, FLAGS.TEMPO_MORTO_INTERNO)],
    ['Em fila de espera com Meta e > 100 dias (FILA_META_100D)', contarFlag(todos, FLAGS.FILA_META_100D)],
    ['Sem etiqueta do servidor/dígito', contarFlag(atribuidos, FLAGS.SEM_ETIQUETA_DIGITO)],
    ['Etiqueta divergente do dígito calculado', contarFlag(atribuidos, FLAGS.DIGITO_DIVERGENTE)],
    ['Sem última movimentação (dias contados da chegada na tarefa)', contarFlag(todos, FLAGS.SEM_ULTIMO_MOVIMENTO)],
    ['Assunto ausente', contarFlag(todos, FLAGS.ASSUNTO_AUSENTE)],
  ];
  for (const [rotulo, valor] of totais) linhaDado([rotulo, valor]);
  linha++;

  // 2. Totais por servidor (trabalháveis)
  secao('2. Totais por servidor (trabalháveis)');
  cabecalho(['Servidor', 'Dígitos', 'Trabalháveis', 'Prioridade 1', 'Prioridade 2', 'Prioridade 3', 'Em fila de espera', 'Crítico (peso)', 'Alto (peso)']);
  const soma = { trab: 0, p1: 0, p2: 0, p3: 0, fila: 0, critico: 0, alto: 0 };
  const fillsServidor = [COR.servidor, undefined, COR.trabalhaveis, COR.p1, COR.p2, COR.p3, COR.filaEspera, undefined, undefined];
  for (const [servidor, lista] of distribuicao.porServidor) {
    const trab = lista.filter((p) => p.situacao === 'TRABALHAVEL');
    const conta = (pr: Prioridade) => trab.filter((p) => p.prioridade === pr).length;
    const fila = lista.length - trab.length;
    const critico = trab.filter((p) => p.faixa === 'CRITICO').length;
    const alto = trab.filter((p) => p.faixa === 'ALTO').length;
    const [p1, p2, p3] = [conta('P1'), conta('P2'), conta('P3')];
    soma.trab += trab.length; soma.p1 += p1; soma.p2 += p2; soma.p3 += p3;
    soma.fila += fila; soma.critico += critico; soma.alto += alto;
    linhaDado(
      [servidor, (digitosPorServidor.get(servidor) ?? []).join(', '), trab.length, p1, p2, p3, fila, critico, alto],
      fillsServidor,
    );
  }
  if (distribuicao.naoAtribuidos.length > 0) {
    const trabNA = distribuicao.naoAtribuidos.filter((p) => p.situacao === 'TRABALHAVEL');
    const conta = (pr: Prioridade) => trabNA.filter((p) => p.prioridade === pr).length;
    linhaDado(
      ['(não atribuídos)', '—', trabNA.length, conta('P1'), conta('P2'), conta('P3'),
        distribuicao.naoAtribuidos.length - trabNA.length,
        trabNA.filter((p) => p.faixa === 'CRITICO').length, trabNA.filter((p) => p.faixa === 'ALTO').length],
      Array(NCOLS).fill(COR.cinza),
    );
  }
  linhaDado(
    ['TOTAL (atribuídos)', '', soma.trab, soma.p1, soma.p2, soma.p3, soma.fila, soma.critico, soma.alto],
    Array(NCOLS).fill(COR.totalLinha), true,
  );
  linha++;

  // 3. Metas a um passo de zerar
  secao(`3. Metas a um passo de zerar (≤ ${pesos.limiarMetaAUmPasso} processos restantes na unidade)`);
  cabecalho(['Meta', 'Processos restantes', 'Números', 'Servidor(es)', 'Status', 'Alerta']);
  const metasAUmPasso = [...metasRestantes.entries()]
    .filter(([, restantes]) => restantes <= pesos.limiarMetaAUmPasso)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  if (metasAUmPasso.length === 0) {
    linhaDado(['Nenhuma meta a um passo de zerar no acervo analisado.']);
    ws.mergeCells(linha - 1, 1, linha - 1, 6);
  }
  for (const [meta, restantes] of metasAUmPasso) {
    const procs = todos.filter((p) => p.metas.includes(meta));
    const servidores = [...new Set(procs.map((p) => p.servidor ?? '(não atribuído)'))].sort();
    linhaDado([
      rotuloMeta(meta), restantes,
      procs.map((p) => p.numeroProcesso).join(', '),
      servidores.join(', '),
      'A um passo',
      `A ${rotuloMeta(meta)} será concluída com o saneamento de apenas ${restantes} processo(s).`,
    ], Array(6).fill(COR.p1));
  }
  linha++;

  // 4. Demais metas na unidade
  const demais = [...metasRestantes.entries()]
    .filter(([, restantes]) => restantes > pesos.limiarMetaAUmPasso)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (demais.length > 0) {
    secao('4. Demais Metas na unidade');
    cabecalho(['Meta', 'Total na unidade', 'Trabalháveis', 'Em fila de espera', 'Não atribuídos', 'Status']);
    for (const [meta, total] of demais) {
      const procs = todos.filter((p) => p.metas.includes(meta));
      linhaDado([
        rotuloMeta(meta), total,
        procs.filter((p) => p.servidor && p.situacao === 'TRABALHAVEL').length,
        procs.filter((p) => p.servidor && p.situacao === 'FILA_ESPERA').length,
        procs.filter((p) => !p.servidor).length,
        'Em andamento',
      ]);
    }
    linha++;
  }

  // Método
  const metodo = ws.getCell(linha, 1);
  metodo.value = 'Método';
  metodo.font = { ...FONTE_BASE, bold: true };
  linha++;
  const notas = [
    `Dígito = ${DESCRICAO_MODO_DIGITO[modoDigito]}; processo cujo dígito não tem servidor vai para "Não atribuídos".`,
    `Dias parados = dias desde a última movimentação (fallback: chegada na tarefa, sinalizado por SEM_ULTIMO_MOVIMENTO). Réguas: CNJ > ${pesos.limiarTempoMortoCnj} · interna > ${pesos.limiarTempoMortoInterno}.`,
    `Prioridade: P1 = parado > ${pesos.limiarDiasP1} dias (com ou sem meta) · P2 = etiqueta Meta/GAB · P3 = normal. Peso 0–100 por blocos A–F.`,
    'Fila de espera = tarefa em que o cartório não pode atuar (aguardando terceiro); esses processos ficam fora da aba do servidor e entram em "Filas de espera".',
    'Metas: etiquetas com prefixo de meta (ex.: GAB_Meta_2, ACV_Meta 2) agrupadas na mesma Meta; "restantes" conta o acervo analisado neste job.',
  ];
  for (const nota of notas) {
    const c = ws.getCell(linha, 1);
    c.value = nota;
    c.font = FONTE_LEGENDA;
    c.alignment = { wrapText: true, vertical: 'top' };
    ws.mergeCells(linha, 1, linha, NCOLS);
    linha++;
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ───────────────────────── Saída ─────────────────────────

function novoWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Forum Hub';
  wb.created = new Date();
  return wb;
}

function tituloServidor(servidor: string, digitos: number[]): string {
  return `${servidor} — dígito(s) ${digitos.join(', ')} — processos trabalháveis`;
}

const TITULO_FILAS = 'Filas de espera — acompanhar/cobrar terceiro (não entram na fila de trabalho)';
const TITULO_NAO_ATRIBUIDOS = 'Não atribuídos — dígito sem servidor ou número fora do padrão';
export const NOME_ABA_RESUMO = 'Resumo';

export interface GeracaoDigitoResult { fileName: string; filePath: string; }

/**
 * Gera a saída da distribuição: um único .xlsx (aba "Resumo" primeiro, depois uma
 * por servidor + "Filas de espera" + "Não atribuídos") ou um .zip com um arquivo
 * por servidor e um Resumo.xlsx solto. As abas de servidor contêm só os
 * trabalháveis; os em fila de espera vão para a aba própria (DOC_Peso §3.6/§11.3).
 * O nome do arquivo carrega o jobId — é assim que a rota de download resolve o arquivo certo.
 */
export async function gerarSaidaDigito(
  distribuicao: ResultadoDistribuicao,
  digitosPorServidor: Map<string, number[]>,
  formato: 'xlsx' | 'zip',
  jobId: string,
  pesos: ConfigPeso,
  metasRestantes: Map<string, number> = new Map(),
  reduzida = false,
  modoDigito: ModoDigito = 'sequencial',
): Promise<GeracaoDigitoResult> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const entradas = [...distribuicao.porServidor.entries()].map(([servidor, processos]) => ({
    servidor,
    trabalhaveis: processos.filter((p) => p.situacao === 'TRABALHAVEL'),
  }));
  const filasEspera = [...distribuicao.porServidor.values()]
    .flat()
    .filter((p) => p.situacao === 'FILA_ESPERA');
  const dadosResumo: DadosResumoDigito = { distribuicao, digitosPorServidor, metasRestantes, pesos, modoDigito };

  if (formato === 'xlsx') {
    const wb = novoWorkbook();
    popularSheetResumo(wb.addWorksheet(NOME_ABA_RESUMO), dadosResumo);
    const usados = new Set<string>([NOME_ABA_RESUMO.toLowerCase(), 'filas de espera', 'não atribuídos']);
    for (const { servidor, trabalhaveis } of entradas) {
      let nome = sanitizeSheetName(servidor);
      for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = sanitizeSheetName(`${servidor} (${n})`);
      usados.add(nome.toLowerCase());
      const ws = wb.addWorksheet(nome);
      popularSheetDigito(ws, trabalhaveis, {
        titulo: tituloServidor(servidor, digitosPorServidor.get(servidor) ?? []),
        pesos, variante: 'servidor', reduzida,
      });
    }
    if (filasEspera.length > 0) {
      popularSheetDigito(wb.addWorksheet('Filas de espera'), filasEspera, { titulo: TITULO_FILAS, pesos, variante: 'fila', reduzida });
    }
    if (distribuicao.naoAtribuidos.length > 0) {
      popularSheetDigito(wb.addWorksheet('Não atribuídos'), distribuicao.naoAtribuidos, { titulo: TITULO_NAO_ATRIBUIDOS, pesos, variante: 'nao_atribuidos', reduzida });
    }
    const fileName = `planilha_digito_${jobId}.xlsx`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    await wb.xlsx.writeFile(filePath);
    return { fileName, filePath };
  }

  const zip = new JSZip();
  const nomesUsados = new Set<string>();
  const nomeArquivoLivre = (nomeBase: string) => {
    let arquivo = `${sanitizeFileName(nomeBase)}.xlsx`;
    for (let n = 2; nomesUsados.has(arquivo.toLowerCase()); n++) arquivo = `${sanitizeFileName(nomeBase)}_${n}.xlsx`;
    nomesUsados.add(arquivo.toLowerCase());
    return arquivo;
  };
  const adicionar = async (nomeBase: string, processos: ProcessoDigito[], titulo: string, variante: VarianteSheet) => {
    const wb = novoWorkbook();
    popularSheetDigito(wb.addWorksheet(sanitizeSheetName(nomeBase)), processos, { titulo, pesos, variante, reduzida });
    zip.file(nomeArquivoLivre(nomeBase), await wb.xlsx.writeBuffer());
  };

  // Resumo em arquivo solto, antes dos servidores.
  const wbResumo = novoWorkbook();
  popularSheetResumo(wbResumo.addWorksheet(NOME_ABA_RESUMO), dadosResumo);
  zip.file(nomeArquivoLivre(NOME_ABA_RESUMO), await wbResumo.xlsx.writeBuffer());

  for (const { servidor, trabalhaveis } of entradas) {
    await adicionar(servidor, trabalhaveis, tituloServidor(servidor, digitosPorServidor.get(servidor) ?? []), 'servidor');
  }
  if (filasEspera.length > 0) await adicionar('Filas_de_espera', filasEspera, TITULO_FILAS, 'fila');
  if (distribuicao.naoAtribuidos.length > 0) await adicionar('Nao_atribuidos', distribuicao.naoAtribuidos, TITULO_NAO_ATRIBUIDOS, 'nao_atribuidos');

  const fileName = `planilha_digito_${jobId}.zip`;
  const filePath = path.join(OUTPUT_DIR, fileName);
  fs.writeFileSync(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { fileName, filePath };
}
