import type ExcelJS from 'exceljs';

/** Estilo padrão das planilhas geradas no servidor (advogados e dígito). */

export const XLSX_HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' },
};

export const XLSX_HEADER_FONT: Partial<ExcelJS.Font> = {
  name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' },
};

export const XLSX_TITLE_FONT: Partial<ExcelJS.Font> = {
  name: 'Arial', bold: true, size: 11, color: { argb: 'FF2F5496' },
};

export const XLSX_DATA_FONT: Partial<ExcelJS.Font> = { name: 'Arial', size: 10 };

export const XLSX_THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' },
};

export function aplicarEstiloCabecalho(cell: ExcelJS.Cell): void {
  cell.font = XLSX_HEADER_FONT;
  cell.fill = XLSX_HEADER_FILL;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = XLSX_THIN_BORDER;
}

export function aplicarEstiloDado(cell: ExcelJS.Cell): void {
  cell.font = XLSX_DATA_FONT;
  cell.alignment = { vertical: 'top', wrapText: true };
  cell.border = XLSX_THIN_BORDER;
}
