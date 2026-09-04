import * as path from 'node:path';
import * as fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { PesosPrioridade, ProcessoDigito } from '../../../../shared/types';
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
const COR_P1 = 'FFC00000';
const COR_P2 = 'FF9C6500';

const CABECALHO = [
  'Número do processo', 'Dígito', 'Tarefa atual', 'Dias parados',
  'Etiquetas', 'Metas', 'Prioridade', 'Pontuação', 'Flags', 'Assunto',
];

const LARGURAS = [26, 8, 34, 12, 40, 22, 11, 11, 30, 30];

function sanitizeSheetName(name: string): string {
  const base = name.replace(INVALID_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim() || 'Planilha';
  return base.length > MAX_SHEET_NAME_LEN ? base.slice(0, MAX_SHEET_NAME_LEN).trim() : base;
}

function sanitizeFileName(name: string): string {
  return (name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, '_').trim() || 'servidor').slice(0, 80);
}

interface SheetOpts {
  titulo: string;
  pesos: PesosPrioridade;
  incluirMotivo: boolean;
}

function motivoNaoAtribuido(proc: ProcessoDigito): string {
  if (proc.flags.includes(FLAGS.NUMERO_MALFORMADO)) return 'Número de processo fora do padrão CNJ';
  return `Dígito ${proc.digito} sem servidor atribuído`;
}

function popularSheetDigito(ws: ExcelJS.Worksheet, processos: ProcessoDigito[], opts: SheetOpts): void {
  const colunas = opts.incluirMotivo ? [...CABECALHO, 'Motivo'] : CABECALHO;
  ws.columns = colunas.map((_, i) => ({ width: LARGURAS[i] ?? 26 }));

  const titulo = ws.getCell(1, 1);
  titulo.value = `${opts.titulo} — ${processos.length} processo(s) — gerado em ${new Date().toLocaleDateString('pt-BR')}`;
  titulo.font = XLSX_TITLE_FONT;
  ws.mergeCells(1, 1, 1, colunas.length);

  const legenda = ws.getCell(2, 1);
  legenda.value =
    'Prioridade: P1 = Meta em tempo morto · P2 = etiqueta de Meta · P3 = tempo morto '
    + `≥ ${opts.pesos.limiarTempoMortoDias} dias · P4 = andamento normal. `
    + 'Ordem: maior pontuação primeiro (pesos: metas do BI, tempo parado, antiguidade).';
  legenda.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
  ws.mergeCells(2, 1, 2, colunas.length);

  const legendaCores = ws.getCell(3, 1);
  legendaCores.value = `Dias parados: laranja ≥ ${opts.pesos.limiarAlertaDias} · vermelho ≥ ${opts.pesos.limiarCriticoDias} (régua CNJ de tempo morto: ${opts.pesos.limiarTempoMortoDias} dias sem movimentação)`;
  legendaCores.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
  ws.mergeCells(3, 1, 3, colunas.length);

  const LINHA_CABECALHO = 4;
  const headerRow = ws.getRow(LINHA_CABECALHO);
  colunas.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    aplicarEstiloCabecalho(cell);
  });

  processos.forEach((p, idx) => {
    const row = ws.getRow(LINHA_CABECALHO + 1 + idx);
    const tarefa = p.outrasTarefas.length > 0
      ? `${p.tarefaAtual}\n+ também em: ${p.outrasTarefas.join('; ')}`
      : p.tarefaAtual;
    const valores: Array<string | number> = [
      p.numeroProcesso,
      p.digito ?? '—',
      tarefa,
      p.diasParados ?? '—',
      p.etiquetas.join(', '),
      p.metas.join(', '),
      p.prioridade,
      p.pontuacao,
      p.flags.join(', '),
      p.assuntoPrincipal || '',
    ];
    if (opts.incluirMotivo) valores.push(motivoNaoAtribuido(p));
    row.values = valores;
    row.eachCell((cell) => { aplicarEstiloDado(cell); });

    const diasCell = row.getCell(4);
    if (typeof p.diasParados === 'number') {
      if (p.diasParados >= opts.pesos.limiarCriticoDias) diasCell.fill = FILL_CRITICO;
      else if (p.diasParados >= opts.pesos.limiarAlertaDias) diasCell.fill = FILL_ALERTA;
    }

    const prioridadeCell = row.getCell(7);
    if (p.prioridade === 'P1') prioridadeCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COR_P1 } };
    else if (p.prioridade === 'P2') prioridadeCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: COR_P2 } };
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
  return `${servidor} — dígito(s) ${digitos.join(', ')}`;
}

export interface GeracaoDigitoResult { fileName: string; filePath: string; }

/**
 * Gera a saída da distribuição: um único .xlsx (aba por servidor + "Não
 * atribuídos") ou um .zip com um arquivo por servidor. O nome do arquivo
 * carrega o jobId — é assim que a rota de download resolve o arquivo certo.
 */
export async function gerarSaidaDigito(
  distribuicao: ResultadoDistribuicao,
  digitosPorServidor: Map<string, number[]>,
  formato: 'xlsx' | 'zip',
  jobId: string,
  pesos: PesosPrioridade,
): Promise<GeracaoDigitoResult> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const entradas: Array<{ servidor: string; processos: ProcessoDigito[] }> =
    [...distribuicao.porServidor.entries()].map(([servidor, processos]) => ({ servidor, processos }));

  if (formato === 'xlsx') {
    const wb = novoWorkbook();
    const usados = new Set<string>();
    for (const { servidor, processos } of entradas) {
      let nome = sanitizeSheetName(servidor);
      for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = sanitizeSheetName(`${servidor} (${n})`);
      usados.add(nome.toLowerCase());
      const ws = wb.addWorksheet(nome);
      popularSheetDigito(ws, processos, {
        titulo: tituloServidor(servidor, digitosPorServidor.get(servidor) ?? []),
        pesos, incluirMotivo: false,
      });
    }
    if (distribuicao.naoAtribuidos.length > 0) {
      const ws = wb.addWorksheet('Não atribuídos');
      popularSheetDigito(ws, distribuicao.naoAtribuidos, {
        titulo: 'Não atribuídos — dígito sem servidor ou número fora do padrão',
        pesos, incluirMotivo: true,
      });
    }
    const fileName = `planilha_digito_${jobId}.xlsx`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    await wb.xlsx.writeFile(filePath);
    return { fileName, filePath };
  }

  const zip = new JSZip();
  const nomesUsados = new Set<string>();
  const adicionar = async (nomeBase: string, processos: ProcessoDigito[], titulo: string, incluirMotivo: boolean) => {
    const wb = novoWorkbook();
    const ws = wb.addWorksheet(sanitizeSheetName(nomeBase));
    popularSheetDigito(ws, processos, { titulo, pesos, incluirMotivo });
    let arquivo = `${sanitizeFileName(nomeBase)}.xlsx`;
    for (let n = 2; nomesUsados.has(arquivo.toLowerCase()); n++) arquivo = `${sanitizeFileName(nomeBase)}_${n}.xlsx`;
    nomesUsados.add(arquivo.toLowerCase());
    const buffer = await wb.xlsx.writeBuffer();
    zip.file(arquivo, buffer);
  };

  for (const { servidor, processos } of entradas) {
    await adicionar(servidor, processos, tituloServidor(servidor, digitosPorServidor.get(servidor) ?? []), false);
  }
  if (distribuicao.naoAtribuidos.length > 0) {
    await adicionar('Nao_atribuidos', distribuicao.naoAtribuidos,
      'Não atribuídos — dígito sem servidor ou número fora do padrão', true);
  }

  const fileName = `planilha_digito_${jobId}.zip`;
  const filePath = path.join(OUTPUT_DIR, fileName);
  const conteudo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(filePath, conteudo);
  return { fileName, filePath };
}
