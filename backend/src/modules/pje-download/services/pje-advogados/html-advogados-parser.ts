import type { AdvogadoInfo } from '../../../../shared/types';

/**
 * Parser HTML para extração de advogados do PJE/TJBA.
 *
 * Estratégia (alinhada com pje_automation_gui Python):
 * 1. Localizar SECAO de cada polo via div id="poloAtivo" / "poloPassivo"
 * 2. Para cada seção, buscar <a href="...%28ADVOGADO%29..."><span>DADOS</span></a>
 *    Esse padrão é específico — o href contém "(ADVOGADO)" URL-encoded,
 *    o que descarta links de partes (AUTOR, REU, REQUERENTE, etc).
 * 3. Fallback: <a> com %28DEFENSOR para defensores públicos.
 * 4. Parsear o span: "NOME - OAB UFNUM - CPF: XXX (ADVOGADO)"
 */

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

function decodeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&[a-zA-Z]+;/g, (e) => HTML_ENTITY_MAP[e] ?? e)
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function cleanText(raw: string): string {
  return decodeHtml(stripTags(raw)).replace(/\s+/g, ' ').trim();
}

/**
 * Extrai a seção HTML de um polo (poloAtivo ou poloPassivo).
 * Procura o início do div com id correspondente e termina no próximo div
 * de mesmo nível (poloPassivo, recursosInternos, maisDetalhes).
 */
function extractPoloSection(html: string, poloId: 'poloAtivo' | 'poloPassivo'): string {
  const startRegex = new RegExp(`<div\\s+id="${poloId}"[^>]*>`, 'i');
  const startMatch = html.match(startRegex);
  if (!startMatch || startMatch.index === undefined) return '';

  const startPos = startMatch.index;
  const fimIds = ['poloAtivo', 'poloPassivo', 'recursosInternos', 'maisDetalhes']
    .filter((id) => id !== poloId);

  let endPos = html.length;
  for (const fid of fimIds) {
    const re = new RegExp(`<div\\s+id="${fid}"`, 'i');
    const m = html.substring(startPos + 20).match(re);
    if (m && m.index !== undefined) {
      const candidate = startPos + 20 + m.index;
      if (candidate < endPos) endPos = candidate;
    }
  }

  return html.substring(startPos, endPos);
}

/**
 * Parseia o conteúdo do span de um advogado.
 * Formato: "NOME - OAB UFNUM - CPF: XXX.XXX.XXX-XX (ADVOGADO)"
 */
function parseAdvogadoSpan(spanContent: string, tipoParte: 'ATIVO' | 'PASSIVO'): AdvogadoInfo | null {
  const texto = cleanText(spanContent);
  if (!texto || texto.length < 3) return null;

  // Descarta se for parte (proteção extra)
  if (/^\s*\((AUTOR|REU|RÉU|REQUERENTE|REQUERIDO|EXEQUENTE|EXECUTADO|IMPETRANTE|IMPETRADO)\)/i.test(texto)) {
    return null;
  }

  // OAB: "OAB BA33407", "OAB SE 6662", "OAB BA 33407A"
  const oabMatch = texto.match(/OAB\s*([A-Z]{2})\s*(\d+[A-Z]?)/i);
  const oab = oabMatch ? `OAB ${oabMatch[1].toUpperCase()}${oabMatch[2]}` : undefined;

  // CPF: "CPF: 130.886.688-70"
  const cpfMatch = texto.match(/CPF:\s*([\d.\-/]+)/i);
  const cpf = cpfMatch?.[1];

  // Nome: tudo antes de " - OAB" ou " - CPF" ou " (ADVOGADO)" ou " (DEFENSOR"
  let nome = '';
  const nomeMatch = texto.match(/^(.+?)(?:\s*-\s*OAB|\s*-\s*CPF|\s*\(ADVOGADO\)|\s*\(DEFENSOR)/i);
  if (nomeMatch) {
    nome = nomeMatch[1].trim();
  } else {
    nome = texto.replace(/\s*\(ADVOGADO\).*$/i, '').replace(/\s*\(DEFENSOR[^)]*\).*$/i, '').trim();
  }
  nome = nome.replace(/[\s\-–]+$/g, '').trim();

  if (!nome || nome.length < 3) return null;

  return { nome, oab, cpf, tipoParte };
}

/**
 * Extrai advogados de uma seção HTML específica de um polo.
 * Usa apenas padrões SEGUROS:
 * - Links cujo href contém %28ADVOGADO%29 (URL-encoded "(ADVOGADO)")
 * - Links cujo href contém %28DEFENSOR (DEFENSOR PÚBLICO/DATIVO)
 *
 * NÃO usa padrões amplos como "qualquer span com (ADVOGADO)" ou
 * "link com OAB" pois geram falsos positivos (partes que mencionam
 * advogados, links de pessoaHome de partes, etc).
 */
function extractAdvogadosFromSection(sectionHtml: string, tipoParte: 'ATIVO' | 'PASSIVO'): AdvogadoInfo[] {
  const advogados: AdvogadoInfo[] = [];
  const seen = new Set<string>();

  const addUnique = (adv: AdvogadoInfo | null): void => {
    if (!adv) return;
    const key = adv.nome.toUpperCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    advogados.push(adv);
  };

  // Padrão 1: link com %28ADVOGADO%29 + span filho
  const advogadoPattern = /<a\s+href="[^"]*%28ADVOGADO%29[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = advogadoPattern.exec(sectionHtml)) !== null) {
    addUnique(parseAdvogadoSpan(m[1], tipoParte));
  }

  // Padrão 2: link com %28DEFENSOR... (DEFENSOR PÚBLICO ou DEFENSOR DATIVO)
  const defensorPattern = /<a\s+href="[^"]*%28DEFENSOR[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/a>/gi;
  while ((m = defensorPattern.exec(sectionHtml)) !== null) {
    addUnique(parseAdvogadoSpan(m[1], tipoParte));
  }

  return advogados;
}

/**
 * API pública: extrai advogados do HTML completo de listAutosDigitais.seam.
 */
export function extractAdvogadosFromHtml(html: string): {
  advogadosPoloAtivo: AdvogadoInfo[];
  advogadosPoloPassivo: AdvogadoInfo[];
} {
  if (!html || html.length < 500) {
    return { advogadosPoloAtivo: [], advogadosPoloPassivo: [] };
  }

  const ativoSection = extractPoloSection(html, 'poloAtivo');
  const passivoSection = extractPoloSection(html, 'poloPassivo');

  const advogadosPoloAtivo = ativoSection ? extractAdvogadosFromSection(ativoSection, 'ATIVO') : [];
  const advogadosPoloPassivo = passivoSection ? extractAdvogadosFromSection(passivoSection, 'PASSIVO') : [];

  return { advogadosPoloAtivo, advogadosPoloPassivo };
}
