import type { ProcessoAdvogados, FiltroAdvogado, AdvogadoInfo, ParteInfo } from '../../../../shared/types';
import * as path from 'node:path';
import * as fs from 'node:fs';
import ExcelJS from 'exceljs';
import {
  XLSX_TITLE_FONT, aplicarEstiloCabecalho, aplicarEstiloDado,
} from '../xlsx-common';

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

// OAB: igualdade normalizada. Nome: substring sem acento/caixa.
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

const MS_POR_DIA = 86_400_000;

function dias(iso: string | undefined, agora: Date): number | '' {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? '' : Math.max(0, Math.floor((agora.getTime() - t) / MS_POR_DIA));
}

function dataBr(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { timeZone: 'America/Bahia' });
}

const simNao = (v: boolean | undefined): string => (v === undefined ? '' : v ? 'Sim' : 'Não');

// Sim = todas as partes do polo têm CPF/CNPJ; Parcial = só algumas; Não = nenhuma; vazio = polo não lido.
function cadastro(partes: ParteInfo[]): string {
  if (partes.length === 0) return '';
  const com = partes.filter((p) => p.documento).length;
  return com === partes.length ? 'Sim' : com === 0 ? 'Não' : 'Parcial';
}
const linhas = (xs: string[]): string => xs.filter(Boolean).join('\n');

const COLUNAS: Array<{ titulo: string; largura: number }> = [
  { titulo: 'Nº Processo', largura: 26 },
  { titulo: 'Polo Ativo (Parte)', largura: 34 },
  { titulo: 'CPF/CNPJ Polo Ativo', largura: 20 },
  { titulo: 'CPF/CNPJ Polo Ativo?', largura: 12 },
  { titulo: 'Advogado(s) Polo Ativo', largura: 36 },
  { titulo: 'OAB Polo Ativo', largura: 16 },
  { titulo: 'CPF Advogado(s) Polo Ativo', largura: 18 },
  { titulo: 'Polo Passivo (Parte)', largura: 34 },
  { titulo: 'CPF/CNPJ Polo Passivo', largura: 20 },
  { titulo: 'CPF/CNPJ Polo Passivo?', largura: 12 },
  { titulo: 'Advogado(s) Polo Passivo', largura: 36 },
  { titulo: 'OAB Polo Passivo', largura: 16 },
  { titulo: 'CPF Advogado(s) Polo Passivo', largura: 18 },
  { titulo: 'Classe Judicial', largura: 18 },
  { titulo: 'Assunto Principal', largura: 28 },
  { titulo: 'Órgão Julgador', largura: 30 },
  { titulo: 'Tarefa', largura: 34 },
  { titulo: 'Data Chegada', largura: 18 },
  { titulo: 'Dias na Tarefa', largura: 12 },
  { titulo: 'Último Movimento', largura: 18 },
  { titulo: 'Dias sem Movimento', largura: 12 },
  { titulo: 'Descrição Último Movimento', largura: 40 },
  { titulo: 'Etiquetas', largura: 26 },
  { titulo: 'Cargo Judicial', largura: 22 },
  { titulo: 'Conferido', largura: 10 },
  { titulo: 'Sigiloso', largura: 10 },
  { titulo: 'Prioridade', largura: 10 },
  { titulo: 'Nível de Acesso', largura: 10 },
  { titulo: 'Sessão em Lote', largura: 10 },
  { titulo: 'Parte Moradora de Rua', largura: 12 },
  { titulo: 'Status', largura: 18 },
];
const COL_STATUS = COLUNAS.length;

function linhaProcesso(p: ProcessoAdvogados, agora: Date): Array<string | number> {
  return [
    p.numeroProcesso,
    p.partesPoloAtivo.length ? linhas(p.partesPoloAtivo.map((x) => x.nome)) : p.poloAtivo,
    linhas(p.partesPoloAtivo.map((x) => x.documento || '')),
    cadastro(p.partesPoloAtivo),
    linhas(p.advogadosPoloAtivo.map((a) => a.nome)),
    linhas(p.advogadosPoloAtivo.map((a) => a.oab || '')),
    linhas(p.advogadosPoloAtivo.map((a) => a.cpf || '')),
    p.partesPoloPassivo.length ? linhas(p.partesPoloPassivo.map((x) => x.nome)) : p.poloPassivo,
    linhas(p.partesPoloPassivo.map((x) => x.documento || '')),
    cadastro(p.partesPoloPassivo),
    linhas(p.advogadosPoloPassivo.map((a) => a.nome)),
    linhas(p.advogadosPoloPassivo.map((a) => a.oab || '')),
    linhas(p.advogadosPoloPassivo.map((a) => a.cpf || '')),
    p.classeJudicial || '',
    p.assuntoPrincipal || '',
    p.orgaoJulgador || '',
    p.nomeTarefa || '',
    dataBr(p.dataChegada),
    dias(p.dataChegada, agora),
    dataBr(p.ultimoMovimento),
    dias(p.ultimoMovimento, agora),
    p.descricaoUltimoMovimento || '',
    linhas(p.etiquetas || []),
    p.cargoJudicial || '',
    simNao(p.conferido),
    simNao(p.sigiloso),
    simNao(p.prioridade),
    p.nivelAcesso ?? '',
    simNao(p.podeInserirProcessoSessaoEmLote),
    simNao(p.temParteMoradorDeRua),
    p.erro || 'OK',
  ];
}

function popularSheet(
  ws: ExcelJS.Worksheet,
  processos: ProcessoAdvogados[],
  filtroLabel?: string,
): void {
  const agora = new Date();
  let primeiraLinhaDados = 1;

  if (filtroLabel) {
    const titulo = ws.getCell(1, 1);
    titulo.value = `Filtro aplicado — ${filtroLabel} — ${processos.length} processo(s)`;
    titulo.font = XLSX_TITLE_FONT;
    ws.mergeCells(1, 1, 1, COL_STATUS);
    primeiraLinhaDados = 2;
  }

  ws.columns = COLUNAS.map((c) => ({ width: c.largura }));

  const headerRow = ws.getRow(primeiraLinhaDados);
  COLUNAS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.titulo;
    aplicarEstiloCabecalho(cell);
  });

  processos.forEach((p, idx) => {
    const row = ws.getRow(primeiraLinhaDados + 1 + idx);
    row.values = linhaProcesso(p, agora);
    row.eachCell((cell) => { aplicarEstiloDado(cell); });
    row.getCell(COL_STATUS).font = {
      name: 'Arial', size: 10,
      color: { argb: p.erro ? 'FFFF0000' : 'FF008000' },
    };
  });

  const ultimaLinha = primeiraLinhaDados + processos.length;
  if (ultimaLinha > primeiraLinhaDados) {
    ws.autoFilter = {
      from: { row: primeiraLinhaDados, column: 1 },
      to: { row: ultimaLinha, column: COL_STATUS },
    };
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: primeiraLinhaDados }];
}

// Sheet "Geral" com tudo + uma sheet por filtro de advogado.
export async function gerarXlsx(
  processos: ProcessoAdvogados[],
  filtros: FiltroAdvogado[] = [],
): Promise<{ fileName: string; filePath: string; sheets: string[] }> {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `processos_completo_${timestamp}.xlsx`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fórum Hub';
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
