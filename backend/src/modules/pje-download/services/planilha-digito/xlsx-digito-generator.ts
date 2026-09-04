import * as path from 'node:path';
import * as fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { ConfigPeso, FaixaPeso, ProcessoDigito } from '../../../../shared/types';
import {
  XLSX_TITLE_FONT, aplicarEstiloCabecalho, aplicarEstiloDado,
} from '../xlsx-common';
import type { ResultadoDistribuicao } from './digito-core';
import { FLAGS } from './digito-core';

const OUTPUT_DIR = path.join(process.cwd(), 'downloads', 'planilhas');
const MAX_SHEET_NAME_LEN = 31;
const INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;

const FILL_ALERTA: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
const FILL_CRITICO: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCDD2' } };

const ESTILO_FAIXA: Record<FaixaPeso, { fill: ExcelJS.Fill; font: Partial<ExcelJS.Font>; rotulo: string }> = {
  CRITICO: {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
    font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FF9C0006' } },
    rotulo: 'CRÍTICO',
  },
  ALTO: {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } },
    font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FF9C6500' } },
    rotulo: 'ALTO',
  },
  MEDIO: {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
    font: { name: 'Arial', size: 10, color: { argb: 'FF7F6000' } },
    rotulo: 'MÉDIO',
  },
  NORMAL: {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } },
    font: { name: 'Arial', size: 10, color: { argb: 'FF006100' } },
    rotulo: 'NORMAL',
  },
};

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

function colunasBase(): ColunaDef[] {
  return [
    { titulo: 'Número do processo', largura: 26, valor: (p) => p.numeroProcesso },
    { titulo: 'Dígito', largura: 8, valor: (p) => p.digito ?? '—' },
    { titulo: 'Tarefa atual', largura: 34, valor: tarefaComExtras },
    { titulo: 'Dias parados', largura: 12, valor: (p) => p.diasParados ?? '—' },
    { titulo: 'Etiquetas', largura: 38, valor: (p) => p.etiquetas.join(', ') },
    { titulo: 'Metas', largura: 20, valor: (p) => p.metas.join(', ') },
    { titulo: 'Prioridade', largura: 11, valor: (p) => p.prioridade },
    { titulo: 'Peso', largura: 8, valor: (p) => p.pontuacao },
    { titulo: 'Faixa', largura: 11, valor: (p) => ESTILO_FAIXA[p.faixa].rotulo },
    { titulo: 'Flags', largura: 28, valor: (p) => p.flags.join(', ') },
    { titulo: 'Providência', largura: 44, valor: (p) => p.providencias.join(' | ') },
    { titulo: 'Assunto', largura: 28, valor: (p) => p.assuntoPrincipal || '' },
  ];
}

function colunasDaVariante(variante: VarianteSheet): ColunaDef[] {
  const base = colunasBase();
  if (variante === 'fila') {
    return [
      { titulo: 'Servidor', largura: 16, valor: (p) => p.servidor ?? '—' },
      ...base,
    ];
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
}

function popularSheetDigito(ws: ExcelJS.Worksheet, processos: ProcessoDigito[], opts: SheetOpts): void {
  const colunas = colunasDaVariante(opts.variante);
  ws.columns = colunas.map((c) => ({ width: c.largura }));

  const titulo = ws.getCell(1, 1);
  titulo.value = `${opts.titulo} — ${processos.length} processo(s) — gerado em ${new Date().toLocaleDateString('pt-BR')}`;
  titulo.font = XLSX_TITLE_FONT;
  ws.mergeCells(1, 1, 1, colunas.length);

  const legenda = ws.getCell(2, 1);
  legenda.value =
    'Peso = (Meta + Assunto + Tempo + Rastro BI + Proximidade da baixa) × Situação, de 0 a 100. '
    + `Faixas: CRÍTICO ≥ ${opts.pesos.limiarCritico} (hoje) · ALTO ${opts.pesos.limiarAlto}–${opts.pesos.limiarCritico - 1} (nesta semana) · `
    + `MÉDIO ${opts.pesos.limiarMedio}–${opts.pesos.limiarAlto - 1} (nesta quinzena) · NORMAL < ${opts.pesos.limiarMedio}. `
    + 'Prioridade: P1 = Meta a um passo de zerar · P2 = etiqueta de Meta/GAB · '
    + `P3 = tempo morto > ${opts.pesos.limiarTempoMortoInterno} dias · P4 = andamento normal.`;
  legenda.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
  ws.mergeCells(2, 1, 2, colunas.length);

  const legendaCores = ws.getCell(3, 1);
  legendaCores.value = opts.variante === 'fila'
    ? `Fila de espera: o cartório não pode trabalhar — acompanhar/cobrar terceiro (peso × ${opts.pesos.multiplicadorFilaEspera}). Dias parados: laranja > ${opts.pesos.limiarTempoMortoCnj} · vermelho > ${opts.pesos.limiarTempoMortoInterno}.`
    : `Dias parados: laranja > ${opts.pesos.limiarTempoMortoCnj} (régua CNJ) · vermelho > ${opts.pesos.limiarTempoMortoInterno} (régua interna). Ordem: prioridade, depois peso.`;
  legendaCores.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
  ws.mergeCells(3, 1, 3, colunas.length);

  const LINHA_CABECALHO = 4;
  const headerRow = ws.getRow(LINHA_CABECALHO);
  colunas.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.titulo;
    aplicarEstiloCabecalho(cell);
  });

  const idxDias = colunas.findIndex((c) => c.titulo === 'Dias parados') + 1;
  const idxPrioridade = colunas.findIndex((c) => c.titulo === 'Prioridade') + 1;
  const idxFaixa = colunas.findIndex((c) => c.titulo === 'Faixa') + 1;

  processos.forEach((p, idx) => {
    const row = ws.getRow(LINHA_CABECALHO + 1 + idx);
    row.values = colunas.map((c) => c.valor(p));
    row.eachCell((cell) => { aplicarEstiloDado(cell); });

    if (typeof p.diasParados === 'number') {
      const diasCell = row.getCell(idxDias);
      if (p.diasParados > opts.pesos.limiarTempoMortoInterno) diasCell.fill = FILL_CRITICO;
      else if (p.diasParados > opts.pesos.limiarTempoMortoCnj) diasCell.fill = FILL_ALERTA;
    }

    const prioridadeCell = row.getCell(idxPrioridade);
    if (p.prioridade === 'P1') prioridadeCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF9C0006' } };
    else if (p.prioridade === 'P2') prioridadeCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF9C6500' } };

    const faixaCell = row.getCell(idxFaixa);
    faixaCell.fill = ESTILO_FAIXA[p.faixa].fill;
    faixaCell.font = ESTILO_FAIXA[p.faixa].font;
  });

  const ultimaLinha = LINHA_CABECALHO + processos.length;
  if (ultimaLinha > LINHA_CABECALHO) {
    ws.autoFilter = {
      from: { row: LINHA_CABECALHO, column: 1 },
      to: { row: ultimaLinha, column: colunas.length },
    };
  }
  ws.views = [{ state: 'frozen', ySplit: LINHA_CABECALHO }];
}

function novoWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Forum Hub';
  wb.created = new Date();
  return wb;
}

function tituloServidor(servidor: string, digitos: number[]): string {
  return `${servidor} — dígito(s) ${digitos.join(', ')} — fila de trabalho`;
}

const TITULO_FILAS = 'Filas de espera — acompanhar/cobrar terceiro (não entram na fila de trabalho)';
const TITULO_NAO_ATRIBUIDOS = 'Não atribuídos — dígito sem servidor ou número fora do padrão';

export interface GeracaoDigitoResult { fileName: string; filePath: string; }

/**
 * Gera a saída da distribuição: um único .xlsx (aba por servidor + "Filas de
 * espera" + "Não atribuídos") ou um .zip com um arquivo por servidor. As abas
 * de servidor contêm só os trabalháveis; os em fila de espera vão para a aba
 * própria (DOC_Peso §3.6/§11.3). O nome do arquivo carrega o jobId — é assim
 * que a rota de download resolve o arquivo certo.
 */
export async function gerarSaidaDigito(
  distribuicao: ResultadoDistribuicao,
  digitosPorServidor: Map<string, number[]>,
  formato: 'xlsx' | 'zip',
  jobId: string,
  pesos: ConfigPeso,
): Promise<GeracaoDigitoResult> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const entradas = [...distribuicao.porServidor.entries()].map(([servidor, processos]) => ({
    servidor,
    trabalhaveis: processos.filter((p) => p.situacao === 'TRABALHAVEL'),
  }));
  const filasEspera = [...distribuicao.porServidor.values()]
    .flat()
    .filter((p) => p.situacao === 'FILA_ESPERA');

  if (formato === 'xlsx') {
    const wb = novoWorkbook();
    const usados = new Set<string>(['filas de espera', 'não atribuídos']);
    for (const { servidor, trabalhaveis } of entradas) {
      let nome = sanitizeSheetName(servidor);
      for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = sanitizeSheetName(`${servidor} (${n})`);
      usados.add(nome.toLowerCase());
      const ws = wb.addWorksheet(nome);
      popularSheetDigito(ws, trabalhaveis, {
        titulo: tituloServidor(servidor, digitosPorServidor.get(servidor) ?? []),
        pesos, variante: 'servidor',
      });
    }
    if (filasEspera.length > 0) {
      const ws = wb.addWorksheet('Filas de espera');
      popularSheetDigito(ws, filasEspera, { titulo: TITULO_FILAS, pesos, variante: 'fila' });
    }
    if (distribuicao.naoAtribuidos.length > 0) {
      const ws = wb.addWorksheet('Não atribuídos');
      popularSheetDigito(ws, distribuicao.naoAtribuidos, { titulo: TITULO_NAO_ATRIBUIDOS, pesos, variante: 'nao_atribuidos' });
    }
    const fileName = `planilha_digito_${jobId}.xlsx`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    await wb.xlsx.writeFile(filePath);
    return { fileName, filePath };
  }

  const zip = new JSZip();
  const nomesUsados = new Set<string>();
  const adicionar = async (nomeBase: string, processos: ProcessoDigito[], titulo: string, variante: VarianteSheet) => {
    const wb = novoWorkbook();
    const ws = wb.addWorksheet(sanitizeSheetName(nomeBase));
    popularSheetDigito(ws, processos, { titulo, pesos, variante });
    let arquivo = `${sanitizeFileName(nomeBase)}.xlsx`;
    for (let n = 2; nomesUsados.has(arquivo.toLowerCase()); n++) arquivo = `${sanitizeFileName(nomeBase)}_${n}.xlsx`;
    nomesUsados.add(arquivo.toLowerCase());
    const buffer = await wb.xlsx.writeBuffer();
    zip.file(arquivo, buffer);
  };

  for (const { servidor, trabalhaveis } of entradas) {
    await adicionar(servidor, trabalhaveis, tituloServidor(servidor, digitosPorServidor.get(servidor) ?? []), 'servidor');
  }
  if (filasEspera.length > 0) {
    await adicionar('Filas_de_espera', filasEspera, TITULO_FILAS, 'fila');
  }
  if (distribuicao.naoAtribuidos.length > 0) {
    await adicionar('Nao_atribuidos', distribuicao.naoAtribuidos, TITULO_NAO_ATRIBUIDOS, 'nao_atribuidos');
  }

  const fileName = `planilha_digito_${jobId}.zip`;
  const filePath = path.join(OUTPUT_DIR, fileName);
  const conteudo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, conteudo);
  return { fileName, filePath };
}
