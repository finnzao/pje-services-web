import type { AdvogadoInfo } from '../../../../shared/types';

const ADVOGADO_LINK_PATTERN = /<a\s+href="[^"]*%28ADVOGADO%29[^"]*"[^>]*>\s*<span[^>]*>(.*?)<\/span>\s*<\/a>/gis;
const DEFENSOR_LINK_PATTERN = /<a\s+href="[^"]*%28DEFENSOR[^"]*"[^>]*>\s*<span[^>]*>(.*?)<\/span>\s*<\/a>/gis;
const SPAN_ADVOGADO_PATTERN = /<span[^>]*>[^<]*\(ADVOGADO\)[^<]*<\/span>/gi;
const TREE_ADVOGADO_PATTERN = /<ul[^>]*class="[^"]*tree[^"]*"[^>]*>[\s\S]*?<a[^>]*>\s*<span[^>]*>(.*?)<\/span>\s*<\/a>[\s\S]*?<\/ul>/gi;
const PESSOA_OAB_PATTERN = /<a\s+href="[^"]*pessoaHome[^"]*"[^>]*>\s*<span[^>]*>(.*?OAB.*?)<\/span>\s*<\/a>/gi;
const NOME_PATTERN = /^(.+?)(?:\s*-\s*OAB|\s*-\s*CPF|\s*\(ADVOGADO\)|\s*\(DEFENSOR)/i;
const OAB_PATTERN = /OAB\s*([A-Z]{2})\s*(\d+[A-Z]?)/i;
const CPF_PATTERN = /CPF:\s*([\d.\-/]+)/i;

function decodeHtml(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&ccedil;/gi, 'c').replace(/&atilde;/gi, 'a').replace(/&otilde;/gi, 'o').replace(/&aacute;/gi, 'a').replace(/&eacute;/gi, 'e').replace(/&iacute;/gi, 'i').replace(/&oacute;/gi, 'o').replace(/&uacute;/gi, 'u').replace(/&ordf;/gi, 'a').replace(/&ordm;/gi, 'o').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16))).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parseAdvogadoSpan(raw: string): Omit<AdvogadoInfo, 'tipoParte'> | null {
  const text = decodeHtml(raw);
  if (!text || text.length < 3) return null;
  if (/^\s*\(AUTOR\)|\(REU\)|\(REQUERENTE\)|\(REQUERIDO\)/i.test(text)) return null;
  const nomeMatch = text.match(NOME_PATTERN);
  const nome = nomeMatch ? nomeMatch[1].trim() : text.replace(/\s*\(ADVOGADO\)\s*$/i, '').replace(/\s*\(DEFENSOR[^)]*\)\s*$/i, '').trim();
  if (!nome || nome.length < 2) return null;
  const oabMatch = text.match(OAB_PATTERN);
  const oab = oabMatch ? `OAB ${oabMatch[1]}${oabMatch[2]}` : undefined;
  const cpfMatch = text.match(CPF_PATTERN);
  const cpf = cpfMatch ? cpfMatch[1] : undefined;
  return { nome, oab, cpf };
}

function extractPoloSection(html: string, poloId: string): string {
  const regex1 = new RegExp(`<div[^>]+id=["']${poloId}["'][^>]*>([\\s\\S]*?)(?=<div[^>]+id=["']polo(?:Ativo|Passivo)["']|<div[^>]+class=["'][^"']*col-sm-4[^"']*panel)`, 'i');
  const match1 = html.match(regex1);
  if (match1?.[1] && match1[1].length > 50) return match1[1];
  const otherPolo = poloId === 'poloAtivo' ? 'poloPassivo' : 'poloAtivo';
  const regex2 = new RegExp(`id=["']${poloId}["'][\\s\\S]*?(?=id=["']${otherPolo}["']|$)`, 'i');
  const match2 = html.match(regex2);
  if (match2?.[0] && match2[0].length > 50) return match2[0];
  return '';
}

function extractAdvogadosFromSection(sectionHtml: string, tipoParte: 'ATIVO' | 'PASSIVO'): AdvogadoInfo[] {
  const advogados: AdvogadoInfo[] = [];
  const seen = new Set<string>();
  function addIfNew(parsed: Omit<AdvogadoInfo, 'tipoParte'> | null): boolean {
    if (!parsed) return false;
    const key = parsed.nome.toUpperCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    advogados.push({ ...parsed, tipoParte });
    return true;
  }
  const patterns = [ADVOGADO_LINK_PATTERN, DEFENSOR_LINK_PATTERN, SPAN_ADVOGADO_PATTERN, TREE_ADVOGADO_PATTERN, PESSOA_OAB_PATTERN];
  for (const regex of patterns) { regex.lastIndex = 0; let match; while ((match = regex.exec(sectionHtml)) !== null) { addIfNew(parseAdvogadoSpan(match[1] || match[0])); } }
  return advogados;
}

export function extractAdvogadosFromHtml(html: string): { advogadosPoloAtivo: AdvogadoInfo[]; advogadosPoloPassivo: AdvogadoInfo[]; debug?: any; } {
  const hasAdvogadoLinks = html.includes('%28ADVOGADO%29') || html.includes('(ADVOGADO)');
  const ativoSection = extractPoloSection(html, 'poloAtivo');
  const passivoSection = extractPoloSection(html, 'poloPassivo');
  let advogadosPoloAtivo: AdvogadoInfo[] = [];
  let advogadosPoloPassivo: AdvogadoInfo[] = [];
  if (ativoSection.length > 50) advogadosPoloAtivo = extractAdvogadosFromSection(ativoSection, 'ATIVO');
  if (passivoSection.length > 50) advogadosPoloPassivo = extractAdvogadosFromSection(passivoSection, 'PASSIVO');
  if (advogadosPoloAtivo.length === 0 && advogadosPoloPassivo.length === 0 && hasAdvogadoLinks) {
    const allAdvogados = extractAdvogadosFromSection(html, 'ATIVO');
    if (allAdvogados.length > 0) advogadosPoloAtivo = allAdvogados;
  }
  return { advogadosPoloAtivo, advogadosPoloPassivo };
}
