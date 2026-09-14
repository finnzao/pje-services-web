import ExcelJS from 'exceljs';
import { XLSX_THIN_BORDER } from '../pje-download/services/xlsx-common';
import type { ExecucaoEtiquetas, ProcessoAfetado } from './types';

/**
 * Planilha dos processos afetados por uma execução (os parados há mais de N dias),
 * gerada em memória a partir do histórico — mesma paleta da planilha por dígito.
 */

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

const FONTE: Partial<ExcelJS.Font> = { name: 'Arial', size: 10 };
const COR_CABECALHO = 'FF1F4E78';

const ESTILO_ACAO: Record<ProcessoAfetado['acao'], { rotulo: string; fill: string; font: Partial<ExcelJS.Font> }> = {
  inserida: { rotulo: 'Etiquetada', fill: 'FFD9EAD3', font: { ...FONTE, bold: true, color: { argb: 'FF375623' } } },
  removida: { rotulo: 'Etiqueta removida', fill: 'FFCFE2F3', font: { ...FONTE, bold: true, color: { argb: 'FF1F4E78' } } },
  simulada_insercao: { rotulo: 'Seria etiquetada (simulação)', fill: 'FFFFF2A8', font: { ...FONTE, bold: true, color: { argb: 'FF7F6000' } } },
  simulada_remocao: { rotulo: 'Seria removida (simulação)', fill: 'FFD9D9D9', font: { ...FONTE, bold: true } },
  erro: { rotulo: 'Erro', fill: 'FFF4B6B6', font: { ...FONTE, bold: true, color: { argb: 'FF9C0006' } } },
};

function formatarData(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
}

export async function gerarPlanilhaExecucao(exec: ExecucaoEtiquetas): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Forum Hub';
  wb.created = new Date();
  const ws = wb.addWorksheet('Processos parados');

  const colunas = [
    { titulo: 'Número do processo', largura: 26 },
    { titulo: 'Tarefa atual', largura: 40 },
    { titulo: 'Dias parados', largura: 12 },
    { titulo: 'Última movimentação', largura: 18 },
    { titulo: 'Ação', largura: 28 },
    { titulo: 'Observação', largura: 50 },
  ];
  ws.columns = colunas.map((c) => ({ width: c.largura }));

  const snap = exec.configSnapshot;
  const titulo = ws.getCell(1, 1);
  titulo.value = `Processos parados há mais de ${snap.diasParado} dias — etiqueta "${snap.etiqueta?.nome ?? '?'}"`
    + ` — ${exec.processos.length} processo(s) — ${exec.dryRun ? 'SIMULAÇÃO' : 'aplicado no PJE'} em ${formatarData(exec.iniciadoEm)}`;
  titulo.font = { name: 'Arial', size: 13, bold: true, color: { argb: COR_CABECALHO } };
  ws.mergeCells(1, 1, 1, colunas.length);

  const legenda = ws.getCell(2, 1);
  legenda.value = 'Dias parados contados da data da última movimentação. '
    + (snap.tarefasIgnoradas.length > 0 ? `Tarefas ignoradas: ${snap.tarefasIgnoradas.join(' · ')}. ` : 'Sem tarefas ignoradas. ')
    + `Acervo analisado: ${exec.totais.processosListados} processo(s) em ${exec.totais.tarefasConsideradas} tarefa(s).`;
  legenda.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
  legenda.alignment = { wrapText: true, vertical: 'top' };
  ws.mergeCells(2, 1, 2, colunas.length);
  ws.getRow(2).height = 28;

  const LINHA_CABECALHO = 3;
  colunas.forEach((c, i) => {
    const cell = ws.getCell(LINHA_CABECALHO, i + 1);
    cell.value = c.titulo;
    cell.font = { ...FONTE, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(COR_CABECALHO);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = XLSX_THIN_BORDER;
  });

  const ordenados = [...exec.processos].sort((a, b) => (b.diasParados ?? -1) - (a.diasParados ?? -1));
  ordenados.forEach((p, i) => {
    const row = ws.getRow(LINHA_CABECALHO + 1 + i);
    const estilo = ESTILO_ACAO[p.acao];
    row.values = [p.numeroProcesso, p.tarefa, p.diasParados ?? '—', formatarData(p.dataUltimoMovimento), estilo.rotulo, p.erro ?? ''];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = FONTE;
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = XLSX_THIN_BORDER;
    });
    const dias = row.getCell(3);
    if (typeof p.diasParados === 'number' && p.diasParados > snap.diasParado) {
      dias.fill = solid('FFE06666');
      dias.font = { ...FONTE, bold: true };
    }
    const acao = row.getCell(5);
    acao.fill = solid(estilo.fill);
    acao.font = estilo.font;
    if (p.acao === 'erro') row.getCell(6).fill = solid('FFF8CBAD');
  });

  const ultima = LINHA_CABECALHO + ordenados.length;
  if (ultima > LINHA_CABECALHO) {
    ws.autoFilter = { from: { row: LINHA_CABECALHO, column: 1 }, to: { row: ultima, column: colunas.length } };
  }
  ws.views = [{ state: 'frozen', ySplit: LINHA_CABECALHO }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function nomeArquivoExecucao(exec: ExecucaoEtiquetas): string {
  const data = exec.iniciadoEm.slice(0, 10);
  return `processos_parados_${exec.configSnapshot.diasParado}d_${data}_${exec.id.slice(0, 8)}${exec.dryRun ? '_simulacao' : ''}.xlsx`;
}
