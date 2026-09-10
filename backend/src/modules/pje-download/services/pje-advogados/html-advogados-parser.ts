import type { AdvogadoInfo, ParteInfo, TipoPolo } from '../../../../shared/types';

// Lê os polos da página listAutosDigitais.seam: cada <tr> tem a parte no
// primeiro <a pessoaHome=...> e os representantes numa <ul class="tree">.

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  '&ccedil;': 'ç', '&Ccedil;': 'Ç',
  '&atilde;': 'ã', '&Atilde;': 'Ã',
  '&otilde;': 'õ', '&Otilde;': 'Õ',
  '&aacute;': 'á', '&Aacute;': 'Á',
  '&eacute;': 'é', '&Eacute;': 'É',
  '&iacute;': 'í', '&Iacute;': 'Í',
  '&oacute;': 'ó', '&Oacute;': 'Ó',
  '&uacute;': 'ú', '&Uacute;': 'Ú',
  '&ordf;': 'ª', '&ordm;': 'º',
};

const REPRESENTANTE_HREF = /%28(ADVOGADO|DEFENSOR)/i;

function decodeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&[a-zA-Z]+;/g, (e) => HTML_ENTITY_MAP[e] ?? e)
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

function cleanText(raw: string): string {
  return decodeHtml(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function extractPoloSection(html: string, poloId: 'poloAtivo' | 'poloPassivo'): string {
  const start = html.match(new RegExp(`<div\\s+id="${poloId}"[^>]*>`, 'i'));
  if (!start || start.index === undefined) return '';
  const startPos = start.index;

  let endPos = html.length;
  for (const fid of ['poloAtivo', 'poloPassivo', 'recursosInternos', 'maisDetalhes']) {
    if (fid === poloId) continue;
    const m = html.substring(startPos + 20).match(new RegExp(`<div\\s+id="${fid}"`, 'i'));
    if (m?.index !== undefined) endPos = Math.min(endPos, startPos + 20 + m.index);
  }
  return html.substring(startPos, endPos);
}

// "NOME - OAB UFNUM - CPF: XXX (ADVOGADO)"
function parseAdvogadoSpan(spanContent: string, tipoParte: TipoPolo): AdvogadoInfo | null {
  const texto = cleanText(spanContent);
  if (texto.length < 3) return null;

  const oabMatch = texto.match(/OAB\s*([A-Z]{2})\s*(\d+(?:-?[A-Z])?)/i);
  const oab = oabMatch ? `OAB ${oabMatch[1].toUpperCase()}${oabMatch[2]}` : undefined;
  const cpf = texto.match(/CPF:\s*([\d.\-/]+)/i)?.[1];

  const nomeMatch = texto.match(/^(.+?)(?:\s*-\s*OAB|\s*-\s*CPF|\s*\(ADVOGADO\)|\s*\(DEFENSOR)/i);
  const nome = (nomeMatch ? nomeMatch[1] : texto.replace(/\s*\((ADVOGADO|DEFENSOR)[^)]*\).*$/i, ''))
    .replace(/[\s\-–]+$/g, '').trim();
  if (nome.length < 3) return null;

  return { nome, oab, cpf, tipoParte };
}

// "NOME - CPF: XXX (AUTOR)" | "EMPRESA - CNPJ: XXX (REU)" | "NOME (EXEQUENTE)"
function parseParteSpan(spanContent: string, tipoParte: TipoPolo): ParteInfo | null {
  const texto = cleanText(spanContent);
  if (texto.length < 3) return null;

  const docMatch = texto.match(/(CPF|CNPJ):\s*([\d.\-/]+)/i);
  const participacao = texto.match(/\(([^()]+)\)\s*$/)?.[1]?.trim();
  const nome = texto
    .replace(/\s*-\s*(CPF|CNPJ):.*$/i, '')
    .replace(/\s*\([^()]+\)\s*$/, '')
    .replace(/[\s\-–]+$/g, '').trim();
  if (nome.length < 3) return null;

  return {
    nome, tipoParte, participacao,
    documento: docMatch?.[2],
    tipoDocumento: docMatch ? (docMatch[1].toUpperCase() as 'CPF' | 'CNPJ') : undefined,
  };
}

function extractAdvogadosFromSection(sectionHtml: string, tipoParte: TipoPolo): AdvogadoInfo[] {
  const advogados: AdvogadoInfo[] = [];
  const seen = new Set<string>();
  // Só o primeiro <span> do link: depois dele pode vir <img> (domicílio eletrônico).
  const pattern = /<a\s+href="[^"]*%28(?:ADVOGADO%29|DEFENSOR)[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/gi;
  for (const m of sectionHtml.matchAll(pattern)) {
    const adv = parseAdvogadoSpan(m[1], tipoParte);
    if (!adv || seen.has(adv.nome.toUpperCase())) continue;
    seen.add(adv.nome.toUpperCase());
    advogados.push(adv);
  }
  return advogados;
}

function extractPartesFromSection(sectionHtml: string, tipoParte: TipoPolo): ParteInfo[] {
  const partes: ParteInfo[] = [];
  const seen = new Set<string>();
  for (const tr of sectionHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const link = tr[1].match(/<a\s+href="([^"]*pessoaHome=[^"]*)"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i);
    if (!link || REPRESENTANTE_HREF.test(link[1])) continue;
    const parte = parseParteSpan(link[2], tipoParte);
    if (!parte || seen.has(parte.nome.toUpperCase())) continue;
    seen.add(parte.nome.toUpperCase());
    partes.push(parte);
  }
  return partes;
}

export interface PolosExtraidos {
  advogadosPoloAtivo: AdvogadoInfo[];
  advogadosPoloPassivo: AdvogadoInfo[];
  partesPoloAtivo: ParteInfo[];
  partesPoloPassivo: ParteInfo[];
}

export function extractPolosFromHtml(html: string): PolosExtraidos {
  const vazio: PolosExtraidos = {
    advogadosPoloAtivo: [], advogadosPoloPassivo: [], partesPoloAtivo: [], partesPoloPassivo: [],
  };
  if (!html || html.length < 500) return vazio;

  const ativo = extractPoloSection(html, 'poloAtivo');
  const passivo = extractPoloSection(html, 'poloPassivo');
  return {
    advogadosPoloAtivo: ativo ? extractAdvogadosFromSection(ativo, 'ATIVO') : [],
    advogadosPoloPassivo: passivo ? extractAdvogadosFromSection(passivo, 'PASSIVO') : [],
    partesPoloAtivo: ativo ? extractPartesFromSection(ativo, 'ATIVO') : [],
    partesPoloPassivo: passivo ? extractPartesFromSection(passivo, 'PASSIVO') : [],
  };
}
