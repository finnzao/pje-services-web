import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { ProcessoDigito } from '../shared/types';
import { CONFIG_PESO_PADRAO } from '../modules/pje-download/services/planilha-digito/digito-core';
import { NOME_ABA_RESUMO, gerarSaidaDigito } from '../modules/pje-download/services/planilha-digito/xlsx-digito-generator';
import { gerarPlanilhaExecucao, nomeArquivoExecucao } from '../modules/etiquetas/xlsx-etiquetas';
import type { ExecucaoEtiquetas } from '../modules/etiquetas/types';

function proc(overrides: Partial<ProcessoDigito>): ProcessoDigito {
  return {
    idProcesso: 1, numeroProcesso: '8000001-11.2024.8.05.0001', digito: 1, anoCnj: 2024,
    tarefaAtual: 'Análise', outrasTarefas: [], etiquetas: [], diasParados: 10, metas: [],
    metaAUmPasso: false, situacao: 'TRABALHAVEL', bloqueado: false, prioridade: 'P3',
    pontuacao: 5, faixa: 'NORMAL', blocos: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 1 }, flags: [], providencias: [],
    ...overrides,
  };
}

const gerados: string[] = [];
afterAll(() => { for (const f of gerados) { try { fs.unlinkSync(f); } catch { /* já removido */ } } });

function distribuicaoExemplo() {
  const ana = [
    proc({ idProcesso: 1, numeroProcesso: '8000001-11.2024.8.05.0001', digito: 1, prioridade: 'P1', metas: ['saude'], servidor: 'Ana', diasParados: 130, faixa: 'CRITICO', pontuacao: 80, flags: ['TEMPO_MORTO_INTERNO'] }),
    proc({ idProcesso: 2, numeroProcesso: '8000002-11.2024.8.05.0001', digito: 2, prioridade: 'P2', metas: ['2'], servidor: 'Ana' }),
    proc({ idProcesso: 3, numeroProcesso: '8000003-11.2024.8.05.0001', digito: 3, situacao: 'FILA_ESPERA', servidor: 'Ana', tarefaAtual: 'Aguardando prazo' }),
  ];
  const bia = [proc({ idProcesso: 4, numeroProcesso: '8000004-11.2024.8.05.0001', digito: 4, servidor: 'Bia', metas: ['2'] })];
  const naoAtribuidos = [proc({ idProcesso: 5, numeroProcesso: '8000005-11.2024.8.05.0001', digito: 5, flags: [] })];
  return {
    distribuicao: { porServidor: new Map([['Ana', ana], ['Bia', bia]]), naoAtribuidos },
    digitos: new Map([['Ana', [1, 2, 3]], ['Bia', [4]]]),
    metas: new Map([['saude', 1], ['2', 2]]),
  };
}

describe('gerarSaidaDigito', () => {
  it('xlsx único: aba Resumo vem primeiro com totais, servidores e metas a um passo', async () => {
    const { distribuicao, digitos, metas } = distribuicaoExemplo();
    const { filePath } = await gerarSaidaDigito(distribuicao, digitos, 'xlsx', 'test-xlsx', CONFIG_PESO_PADRAO, metas);
    gerados.push(filePath);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    expect(wb.worksheets.map((w) => w.name)).toEqual([NOME_ABA_RESUMO, 'Ana', 'Bia', 'Filas de espera', 'Não atribuídos']);

    const resumo = wb.getWorksheet(NOME_ABA_RESUMO)!;
    const textos: string[] = [];
    resumo.eachRow((row) => row.eachCell((c) => { if (typeof c.value === 'string') textos.push(c.value); }));
    expect(textos).toContain('1. Totais gerais');
    expect(textos).toContain('2. Totais por servidor (trabalháveis)');
    expect(textos.some((t) => t.startsWith('3. Metas a um passo de zerar'))).toBe(true);
    expect(textos).toContain('Meta saude');
    expect(textos).toContain('Meta 2');

    // Totais gerais: 5 únicos, 3 trabalháveis atribuídos, 1 fila, 1 não atribuído.
    const valorDe = (rotulo: string) => {
      let v: unknown;
      resumo.eachRow((row) => { if (row.getCell(1).value === rotulo) v = row.getCell(2).value; });
      return v;
    };
    expect(valorDe('Processos únicos no acervo analisado')).toBe(5);
    expect(valorDe('Total trabalhável (atribuído a servidor)')).toBe(3);
    expect(valorDe('Total em filas de espera (atribuído a servidor)')).toBe(1);
    expect(valorDe('Não atribuídos — dígito sem servidor')).toBe(1);

    // Linha da Ana: 2 trabalháveis, P1=1, P2=1, fila=1.
    let linhaAna: ExcelJS.Row | undefined;
    resumo.eachRow((row) => { if (row.getCell(1).value === 'Ana') linhaAna = row; });
    expect(linhaAna).toBeDefined();
    expect(linhaAna!.getCell(3).value).toBe(2);
    expect(linhaAna!.getCell(4).value).toBe(1);
    expect(linhaAna!.getCell(5).value).toBe(1);
    expect(linhaAna!.getCell(7).value).toBe(1);

    // Aba do servidor: cabeçalho azul-escuro, linha P1 tingida de rosa, dias > 120 em vermelho.
    const ana = wb.getWorksheet('Ana')!;
    expect((ana.getCell(4, 1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1F4E78');
    expect((ana.getCell(5, 1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFF4B6B6');
    expect((ana.getCell(5, 4).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFE06666');
    expect(ana.getCell(5, 6).value).toBe('P1');
  });

  it('reduzida: só número, dígito, etiquetas e dias parados nas abas de processos', async () => {
    const { distribuicao, digitos, metas } = distribuicaoExemplo();
    const { filePath } = await gerarSaidaDigito(distribuicao, digitos, 'xlsx', 'test-reduzida', CONFIG_PESO_PADRAO, metas, true);
    gerados.push(filePath);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ana = wb.getWorksheet('Ana')!;
    const cabecalho = [1, 2, 3, 4, 5].map((c) => ana.getCell(4, c).value);
    expect(cabecalho).toEqual(['Número do processo', 'Dígito', 'Etiquetas', 'Dias parados', null]);
    expect(ana.getCell(5, 4).value).toBe(130);
    expect(wb.getWorksheet('Filas de espera')!.getCell(4, 1).value).toBe('Servidor');
  });

  it('zip: Resumo.xlsx solto ao lado dos arquivos por servidor', async () => {
    const { distribuicao, digitos, metas } = distribuicaoExemplo();
    const { filePath } = await gerarSaidaDigito(distribuicao, digitos, 'zip', 'test-zip', CONFIG_PESO_PADRAO, metas);
    gerados.push(filePath);
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const nomes = Object.keys(zip.files).sort();
    expect(nomes).toEqual(['Ana.xlsx', 'Bia.xlsx', 'Filas_de_espera.xlsx', 'Nao_atribuidos.xlsx', 'Resumo.xlsx']);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await zip.file('Resumo.xlsx')!.async('nodebuffer') as unknown as ExcelJS.Buffer);
    expect(wb.worksheets[0].name).toBe(NOME_ABA_RESUMO);
  });
});

describe('gerarPlanilhaExecucao', () => {
  const exec: ExecucaoEtiquetas = {
    id: '11111111-2222-3333-4444-555555555555', origem: 'manual', dryRun: false, status: 'completed', etapa: 'concluido',
    progresso: 100, mensagem: 'ok', iniciadoEm: '2026-09-14T10:00:00.000Z', finalizadoEm: '2026-09-14T10:05:00.000Z',
    totais: {
      tarefasConsideradas: 3, tarefasIgnoradas: 1, processosListados: 50, candidatos: 2, inseridas: 1, removidas: 0, erros: 1,
      ignorados: { TAREFA_IGNORADA: 0, SEM_DATA_MOVIMENTO: 0, DENTRO_DO_PRAZO: 48, JA_ETIQUETADO: 0, LIMITE_EXECUCAO: 0 },
    },
    processos: [
      { idProcesso: 1, numeroProcesso: '8000001-11.2024.8.05.0001', tarefa: 'Análise', diasParados: 150, dataUltimoMovimento: '2026-04-17T00:00:00', acao: 'inserida' },
      { idProcesso: 2, numeroProcesso: '8000002-11.2024.8.05.0001', tarefa: 'Análise', diasParados: 300, acao: 'erro', erro: 'PJE respondeu 500' },
    ],
    configSnapshot: { diasParado: 120, etiqueta: { id: 1, nome: 'PARADO_120' }, tarefasIgnoradas: ['Aguardando prazo'], removerQuandoMovimentado: false, limitePorExecucao: 500 },
  };

  it('gera xlsx com os processos ordenados por dias parados e nome de arquivo descritivo', async () => {
    const buffer = await gerarPlanilhaExecucao(exec);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell(3, 1).value).toBe('Número do processo');
    expect(ws.getCell(4, 1).value).toBe('8000002-11.2024.8.05.0001');
    expect(ws.getCell(4, 5).value).toBe('Erro');
    expect(ws.getCell(5, 5).value).toBe('Etiquetada');
    expect((ws.getCell(5, 3).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFE06666');
    expect(nomeArquivoExecucao(exec)).toBe('processos_parados_120d_2026-09-14_11111111.xlsx');
  });
});
