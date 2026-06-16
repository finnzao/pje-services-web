import { PJE_BASE, serializeCookies, type PjeSession } from '../../../../shared/pje-api-client';
import type {
  PesquisaProcessoCriteria,
  SearchResultRow,
  SearchFormOptions,
  ComboOption,
} from '../../../../shared/types';

export const CONSULTA_URL = `${PJE_BASE}/pje/Processo/ConsultaProcesso/listView.seam`;
export const NO_SELECTION = 'org.jboss.seam.ui.NoSelectionConverter.noSelectionValue';
export const SEARCH_TRIGGER = 'fPP:j_id459';
export const RESULTS_PER_PAGE = 20;
export const MAX_RESULTS = 1000;

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&middot;': '·', '&ordf;': 'ª', '&ordm;': 'º',
  '&ccedil;': 'ç', '&Ccedil;': 'Ç', '&atilde;': 'ã', '&Atilde;': 'Ã',
  '&otilde;': 'õ', '&Otilde;': 'Õ', '&ntilde;': 'ñ',
  '&aacute;': 'á', '&Aacute;': 'Á', '&eacute;': 'é', '&Eacute;': 'É',
  '&iacute;': 'í', '&Iacute;': 'Í', '&oacute;': 'ó', '&Oacute;': 'Ó',
  '&uacute;': 'ú', '&Uacute;': 'Ú', '&agrave;': 'à', '&Agrave;': 'À',
  '&acirc;': 'â', '&Acirc;': 'Â', '&ecirc;': 'ê', '&Ecirc;': 'Ê',
  '&icirc;': 'î', '&ocirc;': 'ô', '&Ocirc;': 'Ô', '&ucirc;': 'û',
  '&auml;': 'ä', '&ouml;': 'ö', '&uuml;': 'ü',
};

export function decodeEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&[a-zA-Z]+;/g, (e) => HTML_ENTITY_MAP[e] ?? e)
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCell(html: string): string {
  return decodeEntities(stripTags(html));
}

export function extractViewState(html: string): string | null {
  const patterns = [
    /<input[^>]+name="javax\.faces\.ViewState"[^>]+value="([^"]+)"/i,
    /<input[^>]+value="([^"]+)"[^>]+name="javax\.faces\.ViewState"/i,
    /<input[^>]+id="javax\.faces\.ViewState"[^>]+value="([^"]+)"/i,
    /javax\.faces\.ViewState[\s\S]{0,200}?value="([^"]{2,})"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function parseResultCount(html: string): number {
  const m = html.match(/(\d+)\s+resultados?\s+encontrados?/i);
  return m ? parseInt(m[1], 10) : 0;
}

function parseSelectOptions(html: string, selectName: string): ComboOption[] {
  const re = new RegExp(
    `<select[^>]+(?:id|name)="${selectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</select>`,
    'i',
  );
  const block = html.match(re);
  if (!block) return [];
  const options: ComboOption[] = [];
  const optRe = /<option[^>]+value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = optRe.exec(block[1])) !== null) {
    const value = m[1];
    if (value === NO_SELECTION || value === '') continue;
    const label = decodeEntities(stripTags(m[2]));
    if (label) options.push({ value, label });
  }
  return options;
}

export function parseFormOptions(html: string): SearchFormOptions {
  return {
    ufOab: parseSelectOptions(html, 'fPP:decorationDados:ufOABCombo'),
    jurisdicoes: parseSelectOptions(html, 'fPP:jurisdicaoComboDecoration:jurisdicaoCombo'),
    orgaosJulgadores: parseSelectOptions(html, 'fPP:orgaoJulgadorComboDecoration:orgaoJulgadorCombo'),
  };
}

function extractNosTrigger(rowHtml: string, idProcesso: string): { container: string; single: string } {
  const fnIdx = rowHtml.indexOf('mostrarNosAtuais');
  const scope = fnIdx >= 0 ? rowHtml.slice(fnIdx, fnIdx + 800) : rowHtml;
  const container = scope.match(/'containerId':'(fPP:processosTable:\d+:j_id\d+)'/);
  const single = scope.match(/'ajaxSingle':'(fPP:processosTable:\d+:j_id\d+)'/);
  return {
    container: container?.[1] ?? `fPP:processosTable:${idProcesso}:j_id507`,
    single: single?.[1] ?? `fPP:processosTable:${idProcesso}:j_id508`,
  };
}

export function parseResultRowsFull(html: string): SearchResultRow[] {
  const rows: SearchResultRow[] = [];
  const rowRe = /<tr[^>]*class="rich-table-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html)) !== null) {
    const rowHtml = rm[1];
    const idMatch = rowHtml.match(/fPP:processosTable:(\d+):/);
    if (!idMatch) continue;
    const idProcesso = idMatch[1];
    const cells: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tdRe.exec(rowHtml)) !== null) cells.push(tm[1]);
    if (cells.length < 8) continue;
    const trigger = extractNosTrigger(rowHtml, idProcesso);
    rows.push({
      idProcesso,
      numeroProcesso: cleanCell(cells[0]),
      caracteristicas: cleanCell(cells[1] ?? ''),
      orgaoJulgador: cleanCell(cells[2] ?? ''),
      juizGarantias: cleanCell(cells[3] ?? ''),
      autuadoEm: cleanCell(cells[4] ?? ''),
      classeJudicial: cleanCell(cells[5] ?? ''),
      poloAtivo: cleanCell(cells[6] ?? ''),
      poloPassivo: cleanCell(cells[7] ?? ''),
      noAtual: '',
      ultimaMovimentacao: cleanCell(cells[9] ?? ''),
      nosContainer: trigger.container,
      nosSingle: trigger.single,
    });
  }
  return rows;
}

export function parseResultRows(html: string): Array<{ idProcesso: string; numeroProcesso: string }> {
  return parseResultRowsFull(html).map((r) => ({
    idProcesso: r.idProcesso,
    numeroProcesso: r.numeroProcesso,
  }));
}

export function parseNosAtuais(html: string): string {
  const m = html.match(/<div[^>]+id="[^"]*:nosAtuais"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return '';
  return decodeEntities(stripTags(m[1]));
}

export function validateCriteria(criteria: PesquisaProcessoCriteria): { ok: boolean; error?: string } {
  const nome = (criteria.nomeParte || '').trim();
  if (nome) {
    const palavras = nome.split(/\s+/).filter(Boolean);
    if (palavras.length < 2) {
      return { ok: false, error: 'A pesquisa por Nome da Parte deve conter pelo menos duas palavras.' };
    }
  }
  const advogado = (criteria.nomeAdvogado || '').trim();
  if (advogado) {
    const palavras = advogado.split(/\s+/).filter(Boolean);
    if (palavras.length < 2) {
      return { ok: false, error: 'A pesquisa por Nome do Representante deve conter pelo menos duas palavras.' };
    }
  }
  const preenchido =
    nome ||
    advogado ||
    (criteria.outrosNomes || '').trim() ||
    (criteria.numeroSequencial || '').trim() ||
    (criteria.numeroTribunal || '').trim() ||
    (criteria.numeroOrgao || '').trim() ||
    (criteria.documentoParte || '').trim() ||
    (criteria.assunto || '').trim() ||
    (criteria.classeJudicial || '').trim() ||
    (criteria.numeroDocumento || '').trim() ||
    (criteria.numeroOAB || '').trim() ||
    (criteria.jurisdicao || '').trim() ||
    (criteria.orgaoJulgador || '').trim() ||
    (criteria.dataAutuacaoInicio || '').trim() ||
    (criteria.dataAutuacaoFim || '').trim() ||
    (criteria.valorCausaInicial || '').trim() ||
    (criteria.valorCausaFinal || '').trim();
  if (!preenchido) {
    return { ok: false, error: 'Informe ao menos um critério de pesquisa.' };
  }
  return { ok: true };
}

function currentMonth(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function baseFields(criteria: PesquisaProcessoCriteria, viewState: string): Array<[string, string]> {
  const mes = currentMonth();
  return [
    ['fPP:j_id154:nomeParte', criteria.nomeParte || ''],
    ['fPP:numeroProcesso:numeroSequencial', criteria.numeroSequencial || ''],
    ['fPP:numeroProcesso:numeroDigitoVerificador', criteria.numeroDigito || ''],
    ['fPP:numeroProcesso:Ano', criteria.numeroAno || ''],
    ['fPP:numeroProcesso:ramoJustica', '8'],
    ['fPP:numeroProcesso:respectivoTribunal', criteria.numeroTribunal || ''],
    ['fPP:numeroProcesso:NumeroOrgaoJustica', criteria.numeroOrgao || ''],
    ['fPP:j_id163:outrosNomesAlcunha', criteria.outrosNomes || ''],
    ['fPP:j_id172:nomeAdvogado', criteria.nomeAdvogado || ''],
    ['tipoMascaraDocumento', 'on'],
    ['fPP:dpDec:documentoParte', criteria.documentoParte || ''],
    ['fPP:processoReferenciaDecoration:habilitarMascaraProcessoReferencia', 'true'],
    ['fPP:processoReferenciaDecoration:IdProcessoReferenciaComMascaraDecoration:IdProcessoReferenciaComMascara', ''],
    ['fPP:j_id241:assunto', criteria.assunto || ''],
    ['fPP:j_id250:classeJudicial', criteria.classeJudicial || ''],
    ['fPP:j_id259:numeroDocumento', criteria.numeroDocumento || ''],
    ['fPP:decorationDados:numeroOAB', criteria.numeroOAB || ''],
    ['fPP:decorationDados:letraOAB', criteria.letraOAB || ''],
    ['fPP:decorationDados:ufOABCombo', criteria.ufOAB || NO_SELECTION],
    ['fPP:jurisdicaoComboDecoration:jurisdicaoCombo', criteria.jurisdicao || NO_SELECTION],
    ['fPP:orgaoJulgadorComboDecoration:orgaoJulgadorCombo', criteria.orgaoJulgador || NO_SELECTION],
    ['fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate', criteria.dataAutuacaoInicio || ''],
    ['fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputCurrentDate', mes],
    ['fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate', criteria.dataAutuacaoFim || ''],
    ['fPP:dataAutuacaoDecoration:dataAutuacaoFimInputCurrentDate', mes],
    ['fPP:valorDaCausaDecoration:valorCausaInicial', criteria.valorCausaInicial || ''],
    ['fPP:valorDaCausaDecoration:valorCausaFinal', criteria.valorCausaFinal || ''],
    ['fPP:j_id400:movimentacaoProcessualSuggest', ''],
    ['fPP:j_id400:j_id411_selection', ''],
    ['fPP:j_id417:j_id422', ''],
    ['fPP:j_id417:j_id424:orgaoOrigemCriminal', NO_SELECTION],
    ['fPP:j_id417:numeroProcedCriminal:numeroProcedCriminal', ''],
    ['fPP:j_id417:numeroProcedCriminal:anoProcedCriminal', ''],
    ['fPP:j_id417:numeroProtocoloPolicia:numeroProtocoloPolicia', ''],
    ['fPP:tencentCaptchaTicket', ''],
    ['fPP:tencentCaptchaRandStr', ''],
    ['fPP', 'fPP'],
    ['autoScroll', ''],
    ['javax.faces.ViewState', viewState],
  ];
}

function toBody(pairs: Array<[string, string]>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of pairs) sp.append(k, v);
  return sp.toString();
}

export function buildSearchBody(criteria: PesquisaProcessoCriteria, viewState: string): string {
  const pairs: Array<[string, string]> = [['AJAXREQUEST', '_viewRoot']];
  pairs.push(...baseFields(criteria, viewState));
  pairs.push([SEARCH_TRIGGER, SEARCH_TRIGGER]);
  pairs.push(['AJAX:EVENTS_COUNT', '1']);
  return toBody(pairs);
}

export function buildPaginationBody(criteria: PesquisaProcessoCriteria, viewState: string, page: number): string {
  const pairs: Array<[string, string]> = [['AJAXREQUEST', '_viewRoot']];
  pairs.push(...baseFields(criteria, viewState));
  pairs.push(['fPP:processosTable:scTabela', String(page)]);
  pairs.push(['processosGridCount', String(MAX_RESULTS)]);
  pairs.push(['ajaxSingle', 'fPP:processosTable:scTabela']);
  pairs.push(['AJAX:EVENTS_COUNT', '1']);
  return toBody(pairs);
}

export function buildNosAtuaisBody(
  criteria: PesquisaProcessoCriteria,
  viewState: string,
  idProcesso: string,
  container: string,
  single: string,
): string {
  const pairs: Array<[string, string]> = [['AJAXREQUEST', container]];
  pairs.push(...baseFields(criteria, viewState));
  pairs.push(['idProcessoTrf', idProcesso]);
  pairs.push([single, single]);
  pairs.push(['ajaxSingle', single]);
  pairs.push(['AJAX:EVENTS_COUNT', '1']);
  return toBody(pairs);
}

export function decomposeCNJ(numero: string): {
  numeroSequencial: string;
  numeroDigito: string;
  numeroAno: string;
  numeroTribunal: string;
  numeroOrgao: string;
} | null {
  const digits = (numero || '').replace(/\D/g, '');
  if (digits.length !== 20) return null;
  return {
    numeroSequencial: digits.slice(0, 7),
    numeroDigito: digits.slice(7, 9),
    numeroAno: digits.slice(9, 13),
    numeroTribunal: digits.slice(14, 16),
    numeroOrgao: digits.slice(16, 20),
  };
}

function consultaHeaders(session: PjeSession, referer: string): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Cookie: serializeCookies(session.cookies, 'pje.tjba.jus.br'),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'Faces-Request': 'partial/ajax',
    Origin: PJE_BASE,
    Referer: referer,
  };
}

export async function consultaFetchForm(session: PjeSession): Promise<string> {
  const res = await fetch(CONSULTA_URL, {
    method: 'GET',
    headers: {
      Cookie: serializeCookies(session.cookies, 'pje.tjba.jus.br'),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  return res.text();
}

export async function consultaPost(session: PjeSession, body: string): Promise<string> {
  const res = await fetch(CONSULTA_URL, {
    method: 'POST',
    headers: consultaHeaders(session, CONSULTA_URL),
    body,
    redirect: 'follow',
  });
  return res.text();
}

export async function buscarProcessoPorNumero(
  session: PjeSession,
  numero: string,
): Promise<{ idProcesso: number; numeroProcesso: string } | null> {
  const partes = decomposeCNJ(numero);
  if (!partes) return null;

  const formHtml = await consultaFetchForm(session);
  const viewState = extractViewState(formHtml);
  if (!viewState) return null;

  const criteria: PesquisaProcessoCriteria = {
    numeroSequencial: partes.numeroSequencial,
    numeroDigito: partes.numeroDigito,
    numeroAno: partes.numeroAno,
    numeroTribunal: partes.numeroTribunal,
    numeroOrgao: partes.numeroOrgao,
  };

  const html = await consultaPost(session, buildSearchBody(criteria, viewState));
  const rows = parseResultRowsFull(html);
  if (rows.length === 0) return null;

  const alvo = numero.replace(/\D/g, '');
  const match = rows.find((r) => r.numeroProcesso.replace(/\D/g, '') === alvo) ?? rows[0];
  const id = Number(match.idProcesso);
  if (!id || Number.isNaN(id)) return null;

  return { idProcesso: id, numeroProcesso: match.numeroProcesso || numero };
}
