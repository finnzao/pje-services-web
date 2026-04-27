import type { ProcessoAdvogados, FiltroAdvogado, AdvogadoInfo } from '../../../../shared/types';
import * as path from 'node:path';
import * as fs from 'node:fs';
import ExcelJS from 'exceljs';

const OUTPUT_DIR = path.join(process.cwd(), 'downloads', 'planilhas');
const MAX_SHEET_NAME_LEN = 31;
const INVALID_SHEET_CHARS = /[\\/*?:[\]]/g;

function normalizarTexto(texto: string): string {
  if (!texto) return '';
  return texto
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizarOab(oab?: string): string {
  if (!oab) return '';
  return oab.toUpperCase().replace('OAB', '').replace(/[\s\-./]/g, '');
}

/**
 * Verifica se algum advogado do processo corresponde ao filtro.
 * Match exato para OAB; substring case/accent-insensitive para nome.
 */
function processoCorrespondeFiltro(proc: ProcessoAdvogados, filtro: FiltroAdvogado): boolean {
  const advogados: AdvogadoInfo[] = [...proc.advogadosPoloAtivo, ...proc.advogadosPoloPassivo];
  if (advogados.length === 0) return false;

  if (filtro.tipo === 'oab') {
    const alvo = normalizarOab(filtro.valor);
    if (!alvo) return false;
    return advogados.some((a) => a.oab && normalizarOab(a.oab) === alvo);
  }

  const alvo = normalizarTexto(filtro.valor);
  if (!alvo) return false;
  return advogados.some((a) => a.nome && normalizarTexto(a.nome).includes(alvo));
}

function sanitizeSheetName(name: string, suffix = ''): string {
  let base = name.replace(INVALID_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!base) base = 'Filtro';
  const maxBase = MAX_SHEET_NAME_LEN - suffix.length;
  if (base.length > maxBase) base = base.substring(0, maxBase).trim();
  return `${base}${suffix}`;
}

function gerarNomeSheetUnico(filtro: FiltroAdvogado, usados: Set<string>): string {
  const prefixo = filtro.tipo === 'oab' ? 'OAB ' : '';
  const base = `${prefixo}${filtro.valor}`.trim() || 'Filtro';
  let candidato = sanitizeSheetName(base);
  if (!usados.has(candidato.toLowerCase())) return candidato;

  for (let n = 2; n < 100; n++) {
    candidato = sanitizeSheetName(base, ` (${n})`);
    if (!usados.has(candidato.toLowerCase())) return candidato;
  }
  return sanitizeSheetName(`Filtro_${Date.now()}`);
}

function popularSheet(
  ws: ExcelJS.Worksheet,
  processos: ProcessoAdvogados[],
  filtroLabel?: string,
): void {
  let primeiraLinhaDados = 1;

  if (filtroLabel) {
    const titulo = ws.getCell(1, 1);
    titulo.value = `Filtro aplicado — ${filtroLabel} — ${processos.length} processo(s)`;
    titulo.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FF2F5496' } };
    ws.mergeCells(1, 1, 1, 11);
    primeiraLinhaDados = 2;
  }

  ws.columns = [
    { key: 'num', width: 28 },
    { key: 'pa', width: 30 },
    { key: 'adva', width: 38 },
    { key: 'oaba', width: 18 },
    { key: 'pp', width: 30 },
    { key: 'advp', width: 38 },
    { key: 'oabp', width: 18 },
    { key: 'classe', width: 22 },
    { key: 'assunto', width: 28 },
    { key: 'orgao', width: 28 },
    { key: 'status', width: 18 },
  ];

  const headers = [
    'Nº Processo', 'Polo Ativo (Parte)', 'Advogado(s) Polo Ativo', 'OAB Polo Ativo',
    'Polo Passivo (Parte)', 'Advogado(s) Polo Passivo', 'OAB Polo Passivo',
    'Classe Judicial', 'Assunto Principal', 'Órgão Julgador', 'Status',
  ];

  const headerRow = ws.getRow(primeiraLinhaDados);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  });

  processos.forEach((p, idx) => {
    const row = ws.getRow(primeiraLinhaDados + 1 + idx);
    row.values = [
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
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10 };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    const statusCell = row.getCell(11);
    statusCell.font = {
      name: 'Arial', size: 10,
      color: { argb: p.erro ? 'FFFF0000' : 'FF008000' },
    };
  });

  const ultimaLinha = primeiraLinhaDados + processos.length;
  if (ultimaLinha > primeiraLinhaDados) {
    ws.autoFilter = {
      from: { row: primeiraLinhaDados, column: 1 },
      to: { row: ultimaLinha, column: 11 },
    };
  }
  ws.views = [{ state: 'frozen', ySplit: primeiraLinhaDados }];
}

/**
 * Gera planilha XLSX multi-sheet:
 * - Sheet "Geral" com todos os processos
 * - Uma sheet por filtro com apenas os processos correspondentes
 */
export async function gerarXlsx(
  processos: ProcessoAdvogados[],
  filtros: FiltroAdvogado[] = [],
): Promise<{ fileName: string; filePath: string; sheets: string[] }> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `advogados_pje_${timestamp}.xlsx`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PJE Download';
  wb.created = new Date();

  const wsGeral = wb.addWorksheet('Geral');
  popularSheet(wsGeral, processos);
  const sheetsGeradas = ['Geral'];

  const usados = new Set<string>(['geral']);
  for (const filtro of filtros) {
    if (!filtro?.valor?.trim()) continue;
    const filtrados = processos.filter((p) => processoCorrespondeFiltro(p, filtro));
    const nomeSheet = gerarNomeSheetUnico(filtro, usados);
    const ws = wb.addWorksheet(nomeSheet);
    const label = filtro.tipo === 'oab' ? `OAB: ${filtro.valor}` : `Adv: ${filtro.valor}`;
    popularSheet(ws, filtrados, label);
    usados.add(nomeSheet.toLowerCase());
    sheetsGeradas.push(nomeSheet);
  }

  await wb.xlsx.writeFile(filePath);
  return { fileName, filePath, sheets: sheetsGeradas };
}
