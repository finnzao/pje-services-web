/**
 * Balanço de saneamento (CPF/CNPJ das partes) a partir da planilha
 * "Informações Completas dos Processos".
 *
 *   pnpm balanco:saneamento <planilha.xlsx> [--anos=2] [--desde=AAAA-MM-DD] [--saida=arquivo.xlsx] [--arquivo=regex] [--baixa=regex]
 *
 * Só entram no balanço os processos arquivados/baixados dentro da janela (padrão:
 * últimos 2 anos, pela data do último movimento). Um processo é "saneado" quando
 * os dois polos têm CPF/CNPJ em todas as partes.
 * Arquivar/baixar sem isso é movimento que o DataJud pode rejeitar: a vara
 * trabalhou, mas o processo não conta nas metas e fica pendente no painel de
 * saneamento. O relatório mede esse passivo e o cenário "se todos estivessem saneados".
 */
import * as path from 'node:path';
import ExcelJS from 'exceljs';
import { aplicarEstiloCabecalho, aplicarEstiloDado, XLSX_TITLE_FONT } from '../modules/pje-download/services/xlsx-common';

export type Cadastro = 'Sim' | 'Parcial' | 'Não' | '';

export interface LinhaPlanilha {
  numero: string;
  classe: string;
  tarefa: string;
  descricaoMovimento: string;
  ultimoMovimento: string;
  cadastroAtivo: Cadastro;
  cadastroPassivo: Cadastro;
  status: string;
}

export interface Classificado extends LinhaPlanilha {
  ano: number | null;
  /** Data do último movimento (a baixa, nos arquivados). */
  dataMovimento: Date | null;
  arquivado: boolean;
  /** Arquivado dentro da janela analisada. */
  naJanela: boolean;
  lido: boolean;
  saneado: boolean;
  /** Quais polos ainda precisam de cadastro. */
  pendencia: 'ATIVO' | 'PASSIVO' | 'AMBOS' | 'NENHUMA' | 'NAO_LIDO';
}

export interface Contagem { total: number; saneados: number; naoSaneados: number; naoLidos: number; }

export interface Balanco {
  total: number;
  janela: { desde: string; ate: string };
  /** Arquivados antes da janela: ficam fora do balanço. */
  arquivadosForaDaJanela: number;
  arquivados: Contagem;
  ativos: Contagem;
  pendenciaArquivados: Record<'ATIVO' | 'PASSIVO' | 'AMBOS', number>;
  pendenciaAtivos: Record<'ATIVO' | 'PASSIVO' | 'AMBOS', number>;
  porAno: Array<{ ano: string } & Contagem>;
  porClasse: Array<{ classe: string } & Contagem>;
  cenario: {
    /** Baixas que contam hoje (saneadas). */
    contadasHoje: number;
    /** Baixas que contariam se todos os arquivados estivessem saneados. */
    contadasSeSaneados: number;
    /** Trabalho já feito que hoje não conta. */
    perdidas: number;
    indiceAtual: number;
    indiceSeSaneados: number;
  };
}

const PADRAO_ARQUIVO = /arquiv/i;
const PADRAO_BAIXA = /baixa definitiva|arquivad/i;

// "16/01/2026, 06:08:03" (planilha) ou ISO.
export function parseData(texto: string): Date | null {
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  const d = br
    ? new Date(`${br[3]}-${br[2]}-${br[1]}T${br[4] ?? '00'}:${br[5] ?? '00'}:${br[6] ?? '00'}`)
    : new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface Janela { desde: Date; ate: Date }

export function janelaAnos(anos: number, hoje = new Date()): Janela {
  const desde = new Date(hoje);
  desde.setFullYear(desde.getFullYear() - anos);
  return { desde, ate: hoje };
}

export function classificar(
  linha: LinhaPlanilha,
  janela: Janela,
  padraoArquivo = PADRAO_ARQUIVO,
  padraoBaixa = PADRAO_BAIXA,
): Classificado {
  const lido = linha.cadastroAtivo !== '' && linha.cadastroPassivo !== '';
  const okAtivo = linha.cadastroAtivo === 'Sim';
  const okPassivo = linha.cadastroPassivo === 'Sim';
  const pendencia = !lido ? 'NAO_LIDO'
    : okAtivo && okPassivo ? 'NENHUMA'
      : !okAtivo && !okPassivo ? 'AMBOS'
        : !okAtivo ? 'ATIVO' : 'PASSIVO';
  const ano = parseInt(linha.numero.match(/^\d{7}-\d{2}\.(\d{4})\./)?.[1] ?? '', 10);
  const dataMovimento = parseData(linha.ultimoMovimento);
  const arquivado = padraoArquivo.test(linha.tarefa) || padraoBaixa.test(linha.descricaoMovimento);
  return {
    ...linha,
    ano: Number.isFinite(ano) ? ano : null,
    dataMovimento,
    arquivado,
    naJanela: arquivado && dataMovimento !== null && dataMovimento >= janela.desde && dataMovimento <= janela.ate,
    lido,
    saneado: pendencia === 'NENHUMA',
    pendencia,
  };
}

function contar(itens: Classificado[]): Contagem {
  return {
    total: itens.length,
    saneados: itens.filter((i) => i.saneado).length,
    naoSaneados: itens.filter((i) => i.lido && !i.saneado).length,
    naoLidos: itens.filter((i) => !i.lido).length,
  };
}

function porPendencia(itens: Classificado[]): Record<'ATIVO' | 'PASSIVO' | 'AMBOS', number> {
  return {
    ATIVO: itens.filter((i) => i.pendencia === 'ATIVO').length,
    PASSIVO: itens.filter((i) => i.pendencia === 'PASSIVO').length,
    AMBOS: itens.filter((i) => i.pendencia === 'AMBOS').length,
  };
}

function agrupar<K extends string>(itens: Classificado[], chave: (i: Classificado) => string, nome: K) {
  const grupos = new Map<string, Classificado[]>();
  for (const i of itens) {
    const k = chave(i);
    grupos.set(k, [...(grupos.get(k) ?? []), i]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, lista]) => ({ [nome]: k, ...contar(lista) } as { [P in K]: string } & Contagem));
}

const pct = (parte: number, total: number): number => (total === 0 ? 0 : Math.round((parte / total) * 1000) / 10);

export function balancear(itens: Classificado[], janela: Janela): Balanco {
  const arquivados = itens.filter((i) => i.naJanela);
  const ativos = itens.filter((i) => !i.arquivado);
  const arq = contar(arquivados);
  const lidosArquivados = arq.total - arq.naoLidos;
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  return {
    total: itens.length,
    janela: { desde: dia(janela.desde), ate: dia(janela.ate) },
    arquivadosForaDaJanela: itens.filter((i) => i.arquivado && !i.naJanela).length,
    arquivados: arq,
    ativos: contar(ativos),
    pendenciaArquivados: porPendencia(arquivados),
    pendenciaAtivos: porPendencia(ativos),
    porAno: agrupar(arquivados, (i) => String(i.dataMovimento?.getFullYear() ?? 'sem data'), 'ano'),
    porClasse: agrupar(arquivados, (i) => i.classe || 'sem classe', 'classe'),
    cenario: {
      contadasHoje: arq.saneados,
      contadasSeSaneados: lidosArquivados,
      perdidas: arq.naoSaneados,
      indiceAtual: pct(arq.saneados, lidosArquivados),
      indiceSeSaneados: lidosArquivados ? 100 : 0,
    },
  };
}

// ---------- leitura da planilha ----------

const COLUNAS = {
  numero: 'Nº Processo',
  classe: 'Classe Judicial',
  tarefa: 'Tarefa',
  descricaoMovimento: 'Descrição Último Movimento',
  ultimoMovimento: 'Último Movimento',
  cadastroAtivo: 'CPF/CNPJ Polo Ativo?',
  cadastroPassivo: 'CPF/CNPJ Polo Passivo?',
  status: 'Status',
} as const;

export async function lerPlanilha(caminho: string): Promise<LinhaPlanilha[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.getWorksheet('Geral') ?? wb.worksheets[0];
  if (!ws) throw new Error('Planilha sem abas');

  const indice = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => indice.set(cell.text.trim(), col));
  for (const titulo of Object.values(COLUNAS)) {
    if (!indice.has(titulo)) throw new Error(`Coluna "${titulo}" não encontrada na aba ${ws.name}`);
  }
  const ler = (row: ExcelJS.Row, chave: keyof typeof COLUNAS): string =>
    row.getCell(indice.get(COLUNAS[chave])!).text.trim();

  const linhas: LinhaPlanilha[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const numero = ler(row, 'numero');
    if (!numero) return;
    linhas.push({
      numero,
      classe: ler(row, 'classe'),
      tarefa: ler(row, 'tarefa'),
      descricaoMovimento: ler(row, 'descricaoMovimento'),
      ultimoMovimento: ler(row, 'ultimoMovimento'),
      cadastroAtivo: ler(row, 'cadastroAtivo') as Cadastro,
      cadastroPassivo: ler(row, 'cadastroPassivo') as Cadastro,
      status: ler(row, 'status'),
    });
  });
  return linhas;
}

// ---------- saída ----------

function tabela(ws: ExcelJS.Worksheet, titulo: string, cabecalho: string[], linhas: Array<Array<string | number>>): void {
  const inicio = ws.rowCount + (ws.rowCount ? 2 : 1);
  ws.getCell(inicio, 1).value = titulo;
  ws.getCell(inicio, 1).font = XLSX_TITLE_FONT;
  cabecalho.forEach((h, i) => aplicarEstiloCabecalho(Object.assign(ws.getCell(inicio + 1, i + 1), { value: h })));
  linhas.forEach((l, r) => l.forEach((v, c) => aplicarEstiloDado(Object.assign(ws.getCell(inicio + 2 + r, c + 1), { value: v }))));
}

const linhaContagem = (rotulo: string, c: Contagem): Array<string | number> =>
  [rotulo, c.total, c.saneados, c.naoSaneados, c.naoLidos, pct(c.saneados, c.total - c.naoLidos)];
const CAB_CONTAGEM = ['', 'Total', 'Saneados', 'Sem CPF/CNPJ', 'Não lidos', '% saneados'];

export async function gravarRelatorio(b: Balanco, itens: Classificado[], saida: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 12 }, { width: 12 }];

  tabela(resumo, `Acervo analisado — arquivados de ${b.janela.desde} a ${b.janela.ate}`, CAB_CONTAGEM, [
    linhaContagem('Arquivados / baixados na janela', b.arquivados),
    linhaContagem('Em tramitação', b.ativos),
    linhaContagem('Total da planilha', contar(itens)),
  ]);
  tabela(resumo, 'Fora do balanço', ['', 'Processos'], [
    ['Arquivados antes da janela', b.arquivadosForaDaJanela],
  ]);
  tabela(resumo, 'Arquivados sem CPF/CNPJ: qual polo falta', ['Polo', 'Processos'], [
    ['Só polo ativo', b.pendenciaArquivados.ATIVO],
    ['Só polo passivo', b.pendenciaArquivados.PASSIVO],
    ['Os dois polos', b.pendenciaArquivados.AMBOS],
  ]);
  tabela(resumo, 'Em tramitação sem CPF/CNPJ (corrigir antes de arquivar)', ['Polo', 'Processos'], [
    ['Só polo ativo', b.pendenciaAtivos.ATIVO],
    ['Só polo passivo', b.pendenciaAtivos.PASSIVO],
    ['Os dois polos', b.pendenciaAtivos.AMBOS],
  ]);
  tabela(resumo, 'Impacto na meta (baixas que o DataJud aceita)', ['Cenário', 'Baixas contadas', '% do arquivado'], [
    ['Hoje', b.cenario.contadasHoje, b.cenario.indiceAtual],
    ['Se todos tivessem passado pelo saneamento', b.cenario.contadasSeSaneados, b.cenario.indiceSeSaneados],
    ['Trabalho feito que não conta', b.cenario.perdidas, pct(b.cenario.perdidas, b.cenario.contadasSeSaneados)],
  ]);

  const porAno = wb.addWorksheet('Por ano');
  porAno.columns = [{ width: 12 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 12 }];
  tabela(porAno, 'Arquivados por ano do arquivamento', ['Ano', ...CAB_CONTAGEM.slice(1)],
    b.porAno.map((a) => linhaContagem(a.ano, a).map((v, i) => (i === 0 ? a.ano : v))));

  const porClasse = wb.addWorksheet('Por classe');
  porClasse.columns = [{ width: 22 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 12 }];
  tabela(porClasse, 'Arquivados por classe', ['Classe', ...CAB_CONTAGEM.slice(1)],
    b.porClasse.map((c) => linhaContagem(c.classe, c)));

  const lista = (nome: string, filtro: (i: Classificado) => boolean) => {
    const ws = wb.addWorksheet(nome);
    ws.columns = [{ width: 26 }, { width: 14 }, { width: 8 }, { width: 18 }, { width: 34 }, { width: 20 }, { width: 30 }];
    tabela(ws, nome, ['Nº Processo', 'Polo pendente', 'Ano', 'Classe', 'Tarefa', 'Último movimento', 'Descrição'],
      itens.filter(filtro).map((i) => [i.numero, i.pendencia, i.ano ?? '', i.classe, i.tarefa, i.ultimoMovimento, i.descricaoMovimento]));
    ws.views = [{ state: 'frozen', ySplit: 2 }];
  };
  lista('Arquivados sem cadastro', (i) => i.naJanela && i.lido && !i.saneado);
  lista('Ativos sem cadastro', (i) => !i.arquivado && i.lido && !i.saneado);
  lista('Não lidos', (i) => (i.naJanela || !i.arquivado) && !i.lido);

  await wb.xlsx.writeFile(saida);
}

function imprimir(b: Balanco): void {
  const c = b.cenario;
  console.log(`Processos na planilha: ${b.total} | janela: ${b.janela.desde} a ${b.janela.ate} | arquivados antes da janela (ignorados): ${b.arquivadosForaDaJanela}`);
  console.log(`Arquivados/baixados na janela: ${b.arquivados.total} (saneados ${b.arquivados.saneados}, sem CPF/CNPJ ${b.arquivados.naoSaneados}, não lidos ${b.arquivados.naoLidos})`);
  console.log(`Em tramitação: ${b.ativos.total} (sem CPF/CNPJ ${b.ativos.naoSaneados})`);
  console.log(`Polo pendente nos arquivados: ativo ${b.pendenciaArquivados.ATIVO}, passivo ${b.pendenciaArquivados.PASSIVO}, ambos ${b.pendenciaArquivados.AMBOS}`);
  console.log(`Baixas que contam hoje: ${c.contadasHoje} (${c.indiceAtual}%)`);
  console.log(`Se todos saneados: ${c.contadasSeSaneados} (${c.indiceSeSaneados}%) → ${c.perdidas} baixas de trabalho feito que hoje não contam`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const entrada = args.find((a) => !a.startsWith('--'));
  if (!entrada) {
    console.error('Uso: pnpm balanco:saneamento <planilha.xlsx> [--anos=2] [--desde=AAAA-MM-DD] [--saida=arquivo.xlsx] [--arquivo=regex] [--baixa=regex]');
    process.exit(1);
  }
  const opt = (nome: string) => args.find((a) => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=');
  const padraoArquivo = opt('arquivo') ? new RegExp(opt('arquivo')!, 'i') : PADRAO_ARQUIVO;
  const padraoBaixa = opt('baixa') ? new RegExp(opt('baixa')!, 'i') : PADRAO_BAIXA;
  const saida = opt('saida') ?? path.join(path.dirname(entrada), `balanco_saneamento_${path.basename(entrada, '.xlsx')}.xlsx`);
  const janela = janelaAnos(Number(opt('anos') ?? 2));
  if (opt('desde')) {
    const desde = parseData(opt('desde')!);
    if (!desde) throw new Error(`--desde inválido: ${opt('desde')}`);
    janela.desde = desde;
  }

  const itens = (await lerPlanilha(entrada)).map((l) => classificar(l, janela, padraoArquivo, padraoBaixa));
  const b = balancear(itens, janela);
  imprimir(b);
  await gravarRelatorio(b, itens, saida);
  console.log(`Relatório: ${saida}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
