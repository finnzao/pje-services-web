import type { AdvogadoInfo } from 'shared';

// ─── Padrões de captura de advogados ────────────────────────────────

// Padrão 1: link com %28ADVOGADO%29 no href (mais confiável)
const ADVOGADO_LINK_PATTERN = /<a\s+href="[^"]*%28ADVOGADO%29[^"]*"[^>]*>\s*<span[^>]*>(.*?)<\/span>\s*<\/a>/gis;

// Padrão 2: link com %28DEFENSOR no href
const DEFENSOR_LINK_PATTERN = /<a\s+href="[^"]*%28DEFENSOR[^"]*"[^>]*>\s*<span[^>]*>(.*?)<\/span>\s*<\/a>/gis;

// Padrão 3: span contendo "(ADVOGADO)" em texto
const SPAN_ADVOGADO_PATTERN = /<span[^>]*>[^<]*\(ADVOGADO\)[^<]*<\/span>/gi;

// Padrão 4 (fallback): qualquer link dentro de <ul class="tree"> com span
// Esta é a estrutura real documentada: <ul class="tree"><li><small><a><span>...</span></a></small></li></ul>
const TREE_ADVOGADO_PATTERN = /<ul[^>]*class="[^"]*tree[^"]*"[^>]*>[\s\S]*?<a[^>]*>\s*<span[^>]*>(.*?)<\/span>\s*<\/a>[\s\S]*?<\/ul>/gi;

// Padrão 5 (fallback amplo): qualquer link com pessoaHome no href e span com OAB
const PESSOA_OAB_PATTERN = /<a\s+href="[^"]*pessoaHome[^"]*"[^>]*>\s*<span[^>]*>(.*?OAB.*?)<\/span>\s*<\/a>/gi;

// ─── Padrões de parsing do conteúdo do span ─────────────────────────

const NOME_PATTERN = /^(.+?)(?:\s*-\s*OAB|\s*-\s*CPF|\s*\(ADVOGADO\)|\s*\(DEFENSOR)/i;
const OAB_PATTERN = /OAB\s*([A-Z]{2})\s*(\d+[A-Z]?)/i;
const CPF_PATTERN = /CPF:\s*([\d.\-/]+)/i;

// ─── Helpers ────────────────────────────────────────────────────────

function decodeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ccedil;/gi, 'ç')
    .replace(/&atilde;/gi, 'ã')
    .replace(/&otilde;/gi, 'õ')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ordf;/gi, 'ª')
    .replace(/&ordm;/gi, 'º')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAdvogadoSpan(raw: string): Omit<AdvogadoInfo, 'tipoParte'> | null {
  const text = decodeHtml(raw);
  if (!text || text.length < 3) return null;

  // Filtra textos que claramente não são advogados
  if (/^\s*\(AUTOR\)|\(RÉU\)|\(REQUERENTE\)|\(REQUERIDO\)/i.test(text)) return null;

  const nomeMatch = text.match(NOME_PATTERN);
  const nome = nomeMatch ? nomeMatch[1].trim() : text.replace(/\s*\(ADVOGADO\)\s*$/i, '').replace(/\s*\(DEFENSOR[^)]*\)\s*$/i, '').trim();
  if (!nome || nome.length < 2) return null;

  const oabMatch = text.match(OAB_PATTERN);
  const oab = oabMatch ? `OAB ${oabMatch[1]}${oabMatch[2]}` : undefined;

  const cpfMatch = text.match(CPF_PATTERN);
  const cpf = cpfMatch ? cpfMatch[1] : undefined;

  return { nome, oab, cpf };
}

// ─── Extração de seções dos polos ───────────────────────────────────

/**
 * Extrai a seção HTML de um polo (ativo ou passivo).
 * Usa múltiplas estratégias porque a estrutura HTML do PJE pode variar.
 */
function extractPoloSection(html: string, poloId: string): string {
  // Estratégia 1: regex precisa com lookahead para próximo polo ou panel
  const regex1 = new RegExp(
    `<div[^>]+id=["']${poloId}["'][^>]*>([\\s\\S]*?)(?=<div[^>]+id=["']polo(?:Ativo|Passivo)["']|<div[^>]+class=["'][^"']*col-sm-4[^"']*panel)`,
    'i',
  );
  const match1 = html.match(regex1);
  if (match1?.[1] && match1[1].length > 50) {
    return match1[1];
  }

  // Estratégia 2: captura tudo desde o id do polo até o outro polo
  const otherPolo = poloId === 'poloAtivo' ? 'poloPassivo' : 'poloAtivo';
  const regex2 = new RegExp(
    `id=["']${poloId}["'][\\s\\S]*?(?=id=["']${otherPolo}["']|$)`,
    'i',
  );
  const match2 = html.match(regex2);
  if (match2?.[0] && match2[0].length > 50) {
    return match2[0];
  }

  // Estratégia 3: captura generosa — pega até 80K chars após o id
  const regex3 = new RegExp(`id=["']${poloId}["'][\\s\\S]{0,80000}`, 'i');
  const match3 = html.match(regex3);
  if (match3?.[0]) {
    // Tenta cortar no próximo polo ou em divs de nível superior
    const cutPoints = [
      match3[0].search(/id=["']polo(?:Ativo|Passivo)["']/i),
      match3[0].search(/<div[^>]+class=["'][^"']*col-sm-4[^"']*panel/i),
      match3[0].search(/<div[^>]+id=["'](?:areaDocumento|processoDocumento)/i),
    ].filter((p) => p > 100);

    if (cutPoints.length > 0) {
      const cutAt = Math.min(...cutPoints);
      return match3[0].substring(0, cutAt);
    }
    return match3[0];
  }

  return '';
}

// ─── Extração de advogados de uma seção ─────────────────────────────

function extractAdvogadosFromSection(sectionHtml: string, tipoParte: 'ATIVO' | 'PASSIVO'): AdvogadoInfo[] {
  const advogados: AdvogadoInfo[] = [];
  const seen = new Set<string>();

  function addIfNew(parsed: Omit<AdvogadoInfo, 'tipoParte'> | null, source: string): boolean {
    if (!parsed) return false;
    const key = parsed.nome.toUpperCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    advogados.push({ ...parsed, tipoParte });
    return true;
  }

  // Aplica padrões em ordem de confiabilidade
  const patterns: Array<{ regex: RegExp; name: string }> = [
    { regex: ADVOGADO_LINK_PATTERN, name: 'ADVOGADO_LINK' },
    { regex: DEFENSOR_LINK_PATTERN, name: 'DEFENSOR_LINK' },
    { regex: SPAN_ADVOGADO_PATTERN, name: 'SPAN_ADVOGADO' },
    { regex: TREE_ADVOGADO_PATTERN, name: 'TREE_UL' },
    { regex: PESSOA_OAB_PATTERN, name: 'PESSOA_OAB' },
  ];

  for (const { regex, name } of patterns) {
    regex.lastIndex = 0;
    let match;
    let matchCount = 0;
    while ((match = regex.exec(sectionHtml)) !== null) {
      matchCount++;
      const spanText = match[1] || match[0];
      const parsed = parseAdvogadoSpan(spanText);
      addIfNew(parsed, name);
    }
  }

  return advogados;
}

// ─── Função principal exportada ─────────────────────────────────────

export function extractAdvogadosFromHtml(html: string): {
  advogadosPoloAtivo: AdvogadoInfo[];
  advogadosPoloPassivo: AdvogadoInfo[];
  debug?: {
    htmlLength: number;
    hasPoloAtivo: boolean;
    hasPoloPassivo: boolean;
    ativoSectionLength: number;
    passivoSectionLength: number;
    hasAdvogadoLinks: boolean;
    hasTreeUl: boolean;
    isLoginPage: boolean;
  };
} {
  // Diagnóstico: verifica se o HTML é válido
  const htmlLength = html.length;
  const hasPoloAtivo = /id=["']poloAtivo["']/i.test(html);
  const hasPoloPassivo = /id=["']poloPassivo["']/i.test(html);
  const hasAdvogadoLinks = html.includes('%28ADVOGADO%29') || html.includes('(ADVOGADO)');
  const hasTreeUl = /class=["'][^"']*tree/i.test(html);
  const isLoginPage = html.includes('login.seam') || html.includes('kc-form-login') || html.includes('sso.cloud.pje.jus.br');

  // Log de diagnóstico
  console.log(`[ADVOGADOS-PARSER] HTML: ${htmlLength} chars | poloAtivo=${hasPoloAtivo} poloPassivo=${hasPoloPassivo} | advLinks=${hasAdvogadoLinks} tree=${hasTreeUl} | loginPage=${isLoginPage}`);

  if (isLoginPage && !hasPoloAtivo) {
    console.warn(`[ADVOGADOS-PARSER] ⚠️ HTML parece ser página de login, não autos digitais!`);
  }

  if (htmlLength < 500) {
    console.warn(`[ADVOGADOS-PARSER] ⚠️ HTML muito curto (${htmlLength} chars) — possível resposta de erro`);
  }

  const ativoSection = extractPoloSection(html, 'poloAtivo');
  const passivoSection = extractPoloSection(html, 'poloPassivo');

  console.log(`[ADVOGADOS-PARSER] Seção polo ativo: ${ativoSection.length} chars | polo passivo: ${passivoSection.length} chars`);

  // Se não encontrou seções por id, tenta busca global no HTML inteiro
  let advogadosPoloAtivo: AdvogadoInfo[] = [];
  let advogadosPoloPassivo: AdvogadoInfo[] = [];

  if (ativoSection.length > 50) {
    advogadosPoloAtivo = extractAdvogadosFromSection(ativoSection, 'ATIVO');
  }
  if (passivoSection.length > 50) {
    advogadosPoloPassivo = extractAdvogadosFromSection(passivoSection, 'PASSIVO');
  }

  // Fallback: se não encontrou nada nas seções mas o HTML tem links de advogado,
  // busca no HTML inteiro (sem distinção de polo)
  if (advogadosPoloAtivo.length === 0 && advogadosPoloPassivo.length === 0 && hasAdvogadoLinks) {
    console.log(`[ADVOGADOS-PARSER] Seções de polo vazias mas HTML tem links de advogado — buscando no HTML inteiro`);
    const allAdvogados = extractAdvogadosFromSection(html, 'ATIVO');
    if (allAdvogados.length > 0) {
      console.log(`[ADVOGADOS-PARSER] Encontrados ${allAdvogados.length} advogados via busca global (sem distinção de polo)`);
      // Coloca todos no polo ativo como fallback — melhor que nada
      advogadosPoloAtivo = allAdvogados;
    }
  }

  console.log(`[ADVOGADOS-PARSER] Resultado: ${advogadosPoloAtivo.length} polo ativo, ${advogadosPoloPassivo.length} polo passivo`);

  return {
    advogadosPoloAtivo,
    advogadosPoloPassivo,
    debug: {
      htmlLength,
      hasPoloAtivo,
      hasPoloPassivo,
      ativoSectionLength: ativoSection.length,
      passivoSectionLength: passivoSection.length,
      hasAdvogadoLinks,
      hasTreeUl,
      isLoginPage,
    },
  };
}