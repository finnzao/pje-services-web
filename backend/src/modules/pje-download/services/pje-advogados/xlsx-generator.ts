import type { ProcessoAdvogados, FiltroAdvogado } from '../../../../shared/types';
import * as path from 'node:path';
import * as fs from 'node:fs';
import ExcelJS from 'exceljs';

const OUTPUT_DIR = path.join(process.cwd(), 'downloads', 'planilhas');

export async function gerarXlsx(processos: ProcessoAdvogados[], filtro?: FiltroAdvogado): Promise<{ fileName: string; filePath: string }> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `advogados_pje_${timestamp}.xlsx`;
  const filePath = path.join(OUTPUT_DIR, fileName);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PJE Download'; wb.created = new Date();
  const ws = wb.addWorksheet('Advogados', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'No Processo', key: 'num', width: 28 }, { header: 'Polo Ativo', key: 'pa', width: 30 },
    { header: 'Advogado(s) Polo Ativo', key: 'adva', width: 38 }, { header: 'OAB Polo Ativo', key: 'oaba', width: 20 },
    { header: 'Polo Passivo', key: 'pp', width: 30 }, { header: 'Advogado(s) Polo Passivo', key: 'advp', width: 38 },
    { header: 'OAB Polo Passivo', key: 'oabp', width: 20 }, { header: 'Status', key: 'status', width: 10 },
  ];
  for (const p of processos) {
    ws.addRow({
      num: p.numeroProcesso, pa: p.poloAtivo,
      adva: p.advogadosPoloAtivo.map((a) => a.nome).join('\n'),
      oaba: p.advogadosPoloAtivo.map((a) => a.oab || '').filter(Boolean).join('\n'),
      pp: p.poloPassivo,
      advp: p.advogadosPoloPassivo.map((a) => a.nome).join('\n'),
      oabp: p.advogadosPoloPassivo.map((a) => a.oab || '').filter(Boolean).join('\n'),
      status: p.erro || 'OK',
    });
  }
  await wb.xlsx.writeFile(filePath);
  return { fileName, filePath };
}
