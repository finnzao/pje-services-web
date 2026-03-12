import type { ProcessoAdvogados, FiltroAdvogado } from 'shared';
import * as path from 'node:path';
import * as fs from 'node:fs';
import ExcelJS from 'exceljs';

const OUTPUT_DIR = path.join(process.cwd(), 'downloads', 'planilhas');

const COLUMNS: Array<{ header: string; width: number }> = [
  { header: 'Nº Processo',              width: 28 },
  { header: 'Polo Ativo (Parte)',       width: 30 },
  { header: 'Advogado(s) Polo Ativo',   width: 38 },
  { header: 'OAB Polo Ativo',           width: 20 },
  { header: 'Polo Passivo (Parte)',     width: 30 },
  { header: 'Advogado(s) Polo Passivo', width: 38 },
  { header: 'OAB Polo Passivo',         width: 20 },
  { header: 'Classe Judicial',          width: 22 },
  { header: 'Assunto Principal',        width: 30 },
  { header: 'Órgão Julgador',           width: 34 },
  { header: 'Status',                   width: 10 },
];

const COLORS = {
  headerBg: '1F3864',
  headerFg: 'FFFFFF',
  evenRow:  'D6E4F0',
  oddRow:   'FFFFFF',
  border:   'B4C6E7',
  text:     '1A1A1A',
  okGreen:  '548235',
  errRed:   'C00000',
  filterHeaderBg: '2E75B6',
  filterHeaderFg: 'FFFFFF',
  filterEvenRow:  'DAEEF3',
  summaryBg: 'FFF2CC',
  summaryBorder: 'FFD966',
} as const;

const STATUS_COL = COLUMNS.length;

// ─── Helpers de estilo ──────────────────────────────────────────────

function makeBorder(color: string): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: 'thin', color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

function makeFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function makeFont(overrides: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> {
  return { name: 'Arial', size: 9, color: { argb: COLORS.text }, ...overrides };
}

const CENTER_WRAP: Partial<ExcelJS.Alignment> = {
  horizontal: 'center',
  vertical: 'middle',
  wrapText: true,
};

// ─── Conversão de processo para row ─────────────────────────────────

function processoToRow(p: ProcessoAdvogados): string[] {
  return [
    p.numeroProcesso,
    p.poloAtivo,
    p.advogadosPoloAtivo.map((a) => a.nome).join('\n'),
    p.advogadosPoloAtivo.map((a) => a.oab || '').filter(Boolean).join('\n'),
    p.poloPassivo,
    p.advogadosPoloPassivo.map((a) => a.nome).join('\n'),
    p.advogadosPoloPassivo.map((a) => a.oab || '').filter(Boolean).join('\n'),
    p.classeJudicial || '',
    p.assuntoPrincipal || '',
    p.orgaoJulgador || '',
    p.erro || 'OK',
  ];
}

function calcRowHeight(values: string[]): number {
  const maxLines = Math.max(1, ...values.map((v) => (v ? v.split('\n').length : 1)));
  return Math.max(22, maxLines * 15);
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9À-ÿ ]/g, '_').replace(/_+/g, '_').trim().slice(0, 28);
}

// ─── Criação de uma sheet com dados ─────────────────────────────────

function populateSheet(
  ws: ExcelJS.Worksheet,
  processos: ProcessoAdvogados[],
  headerBg: string,
  headerFg: string,
  evenRowBg: string,
): void {
  // Configura colunas
  ws.columns = COLUMNS.map((col, i) => ({
    header: col.header,
    key: `col${i}`,
    width: col.width,
  }));

  // Estiliza cabeçalho
  const headerRow = ws.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = makeFont({ size: 10, bold: true, color: { argb: headerFg } });
    cell.fill = makeFill(headerBg);
    cell.alignment = CENTER_WRAP;
    cell.border = makeBorder(headerBg);
  });

  // Adiciona dados
  for (let i = 0; i < processos.length; i++) {
    const values = processoToRow(processos[i]);
    const row = ws.addRow(values);
    const bgColor = i % 2 === 0 ? evenRowBg : COLORS.oddRow;
    const status = values[values.length - 1];

    row.height = calcRowHeight(values);

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = colNumber === STATUS_COL
        ? makeFont({ bold: true, color: { argb: status === 'OK' ? COLORS.okGreen : COLORS.errRed } })
        : makeFont();
      cell.fill = makeFill(bgColor);
      cell.alignment = CENTER_WRAP;
      cell.border = makeBorder(COLORS.border);
    });
  }

  // Filtros automáticos
  if (processos.length > 0) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: processos.length + 1, column: COLUMNS.length },
    };
  }
}

// ─── Adiciona resumo na sheet filtrada ──────────────────────────────

function addFilterSummary(
  ws: ExcelJS.Worksheet,
  filtro: FiltroAdvogado,
  totalGeral: number,
  totalFiltrado: number,
): void {
  // Pula uma linha após os dados
  const lastDataRow = ws.rowCount;
  const summaryStartRow = lastDataRow + 2;

  // Linha de resumo
  const summaryTexts = [
    `Filtro aplicado: ${filtro.tipo === 'nome' ? 'Nome' : 'OAB'} contém "${filtro.valor}"`,
    `Processos encontrados: ${totalFiltrado} de ${totalGeral} (${totalGeral > 0 ? Math.round((totalFiltrado / totalGeral) * 100) : 0}%)`,
    `Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
  ];

  for (let i = 0; i < summaryTexts.length; i++) {
    const row = ws.getRow(summaryStartRow + i);
    const cell = row.getCell(1);
    cell.value = summaryTexts[i];
    cell.font = makeFont({ size: 9, bold: i < 2, italic: i === 2, color: { argb: '4A4A4A' } });
    cell.fill = makeFill(COLORS.summaryBg);
    cell.border = makeBorder(COLORS.summaryBorder);
    cell.alignment = { horizontal: 'left', vertical: 'middle' };

    // Mescla as colunas para o texto de resumo
    ws.mergeCells(summaryStartRow + i, 1, summaryStartRow + i, 5);
  }
}

// ─── Aplica filtro nos processos ────────────────────────────────────

function applyFilter(processos: ProcessoAdvogados[], filtro: FiltroAdvogado): ProcessoAdvogados[] {
  const termo = filtro.valor.trim().toUpperCase();
  if (!termo) return processos;

  return processos.filter((p) => {
    const all = [...p.advogadosPoloAtivo, ...p.advogadosPoloPassivo];
    return all.some((adv) =>
      filtro.tipo === 'oab'
        ? adv.oab?.toUpperCase().includes(termo) ?? false
        : adv.nome.toUpperCase().includes(termo),
    );
  });
}

// ─── Gera o nome da sheet filtrada ──────────────────────────────────

function buildFilterSheetName(filtro: FiltroAdvogado): string {
  const prefix = filtro.tipo === 'oab' ? 'OAB' : 'Nome';
  const value = sanitize(filtro.valor);
  // Sheet names no Excel têm limite de 31 caracteres
  const name = `${prefix} - ${value}`;
  return name.slice(0, 31);
}

// ─── Função principal ───────────────────────────────────────────────

export async function gerarXlsx(
  processos: ProcessoAdvogados[],
  filtro?: FiltroAdvogado,
): Promise<{ fileName: string; filePath: string }> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const suffix = filtro?.valor ? `_${filtro.tipo}_${sanitize(filtro.valor)}` : '';
  const fileName = `advogados_pje_${timestamp}${suffix}.xlsx`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PJE Download — TJBA';
  wb.created = new Date();

  const hasFiltro = !!filtro?.valor?.trim();

  if (hasFiltro) {
    // ── COM FILTRO: duas sheets ──────────────────────────────────

    const filteredProcessos = applyFilter(processos, filtro!);

    // Sheet 1: "Geral" com todos os processos
    const wsGeral = wb.addWorksheet('Geral', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    populateSheet(wsGeral, processos, COLORS.headerBg, COLORS.headerFg, COLORS.evenRow);

    // Sheet 2: nome baseado no filtro, com processos filtrados
    const filterSheetName = buildFilterSheetName(filtro!);
    const wsFiltro = wb.addWorksheet(filterSheetName, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    populateSheet(wsFiltro, filteredProcessos, COLORS.filterHeaderBg, COLORS.filterHeaderFg, COLORS.filterEvenRow);
    addFilterSummary(wsFiltro, filtro!, processos.length, filteredProcessos.length);

    console.log(`[XLSX] Gerado com 2 sheets: "Geral" (${processos.length}) + "${filterSheetName}" (${filteredProcessos.length})`);
  } else {
    // ── SEM FILTRO: sheet única ──────────────────────────────────

    const ws = wb.addWorksheet('Advogados', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    populateSheet(ws, processos, COLORS.headerBg, COLORS.headerFg, COLORS.evenRow);

    console.log(`[XLSX] Gerado com 1 sheet: "Advogados" (${processos.length})`);
  }

  await wb.xlsx.writeFile(filePath);

  return { fileName, filePath };
}