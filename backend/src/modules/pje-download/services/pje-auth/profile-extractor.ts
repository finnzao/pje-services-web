import type { PJEProfile, ProfileMapping } from './types';
import { cleanText, decodeHtmlEntities, stripHtml } from './html-parser';

// Tamanho de página real do PJE (confirmado via HAR: 5 perfis por página)
export const PJE_PROFILES_PER_PAGE = 5;

export function extractProfilesFromHtml(html: string): PJEProfile[] {
  const profiles: PJEProfile[] = [];
  const activeFavoriteName = extractFavoriteFromThead(html);
  const tbodyRows = extractTbodyRows(html);

  console.log(`[PJE-AUTH] Rows no tbody: ${tbodyRows.length}`);

  // Perfil favorito do thead (índice -1)
  if (activeFavoriteName) {
    console.log(`[PJE-AUTH] Perfil favorito thead: "${activeFavoriteName}"`);
    const parts = activeFavoriteName.split(' / ');
    profiles.push({
      indice: -1,
      nome: activeFavoriteName,
      orgao: parts[1]?.trim() || '',
      favorito: true,
    });
  }

  // Perfis regulares do tbody
  for (const row of tbodyRows) {
    if (!row.nome) continue;
    // Pula duplicata do favorito
    if (activeFavoriteName && row.nome.toLowerCase().trim() === activeFavoriteName.toLowerCase().trim())
      continue;
    const parts = row.nome.split(' / ');
    profiles.push({
      indice: row.indice,
      nome: row.nome,
      orgao: parts[1]?.trim() || '',
      favorito: row.favorito,
    });
  }

  console.log(`[PJE-AUTH] Total perfis (página atual): ${profiles.length}`);
  for (const p of profiles)
    console.log(`  [${p.indice}] ${p.favorito ? '⭐' : '  '} ${p.nome}`);

  return profiles;
}

// Retorna os índices visíveis na página atual
export function extractVisibleIndices(html: string): number[] {
  return extractTbodyRows(html).map(r => r.indice);
}

// Verifica se há paginação
export function hasPagination(html: string): boolean {
  return html.includes('scPerfil');
}

// Extrai info do scroller: o formId inclui :j_id72 (confirmado via HAR)
export function extractScrollerInfo(html: string): { formId: string; scrollerId: string } | null {
  // Padrão real do PJE: id="papeisUsuarioForm:j_id72:scPerfil"
  const m = html.match(/id="([^"]*:scPerfil)"/);
  if (!m) return null;
  // Remove o :scPerfil para obter o formId do scroller
  const scrollerId = m[1];
  const formId = scrollerId.replace(/:scPerfil$/, '');
  return { formId, scrollerId };
}

// Extrai número total de páginas do scroller
export function extractTotalPages(html: string): number {
  // Pega todos os números (ativos e inativos) do scroller
  const allNums: number[] = [];
  for (const m of html.matchAll(/rich-datascr-(?:act|inact)[^>]*>(\d+)</g))
    allNums.push(parseInt(m[1], 10));
  return allNums.length > 0 ? Math.max(...allNums) : 1;
}

// Extrai a página atual do scroller
export function extractCurrentPage(html: string): number {
  const m = html.match(/rich-datascr-act[^>]*>(\d+)</);
  return m ? parseInt(m[1], 10) : 1;
}

// Calcula em qual página o índice deve estar (5 perfis/pág, índices 0-based)
export function getPageForIndex(profileIndex: number): number {
  if (profileIndex < 0) return 1; // favorito sempre está no thead de toda página
  return Math.floor(profileIndex / PJE_PROFILES_PER_PAGE) + 1;
}

// === Funções internas ===

interface TbodyRow { indice: number; nome: string; favorito: boolean; }

function extractTbodyRows(html: string): TbodyRow[] {
  const rows: TbodyRow[] = [];

  // Encontra tbody com perfis (contém j_id70 ou j_id68 + colPerfil)
  const tbodys = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)];
  let perfisBody = '';

  for (const m of tbodys) {
    if (m[1].includes('j_id70') || (m[1].includes('colPerfil') && m[1].includes('j_id68'))) {
      perfisBody = m[1];
      break;
    }
  }

  if (!perfisBody) return rows;

  // Extrai cada <tr> do tbody
  for (const rowMatch of perfisBody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1];

    // Extrai índice
    const idxMatch = row.match(/dtPerfil:(\d+):(?:j_id70|j_id68|colPerfil|perfilInicial)/);
    if (!idxMatch) continue;
    const indice = parseInt(idxMatch[1], 10);

    // Verifica favorito (estrela sem -disabled)
    const favImg = row.match(/favorite-16x16(-disabled)?\.png/);
    const favorito = favImg ? !favImg[1] : false;

    // Extrai nome pelo link j_id70 (seleção de perfil)
    const namePatterns = [
      new RegExp(`dtPerfil:${indice}:j_id70['"'][^>]*>([\\s\\S]*?)</a>`, 'i'),
      /colPerfil[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
      /<a[^>]*onclick[^>]*jsfcljs[^>]*>([\s\S]*?)<\/a>/i,
    ];

    let nome = '';
    for (const p of namePatterns) {
      const nm = row.match(p);
      if (nm?.[1]) {
        nome = decodeHtmlEntities(stripHtml(nm[1]).trim());
        if (nome.length > 3) break;
      }
    }

    if (!nome || nome.length < 3) continue;
    rows.push({ indice, nome, favorito });
  }

  return rows.sort((a, b) => a.indice - b.indice);
}

// Extrai nome do favorito do thead (somente se favorite-16x16.png presente, sem -disabled)
function extractFavoriteFromThead(html: string): string {
  const theadMatch = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (!theadMatch) return '';

  const thead = theadMatch[1];

  if (!thead.includes('favorite-16x16.png') || thead.includes('favorite-16x16-disabled.png'))
    return '';

  // Busca link j_id66 com texto do perfil
  const patterns = [
    /<a[^>]*id="[^"]*dtPerfil:j_id66"[^>]*>([\s\S]*?)<\/a>/i,
    /<a[^>]*(?:onclick|href)[^>]*dtPerfil:j_id66[^>]*>([\s\S]*?)<\/a>/i,
    /<a[^>]*onclick="[^"]*j_id66[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
  ];

  for (const p of patterns) {
    const m = thead.match(p);
    if (m?.[1]) {
      const text = decodeHtmlEntities(stripHtml(m[1]).trim());
      if (text.length > 3 && !text.startsWith('function') && !text.startsWith('if(')) return text;
    }
  }

  // Fallback: qualquer link com texto razoável
  const links = [...thead.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => decodeHtmlEntities(stripHtml(m[1]).trim()))
    .filter(t => t.length > 10 && !t.startsWith('function') && !t.startsWith('if(') && !t.includes('favorite'));

  return links.sort((a, b) => b.length - a.length)[0] || '';
}

// Constrói mapeamento para navegação de perfis
export function buildProfileMapping(html: string): ProfileMapping[] {
  const result: ProfileMapping[] = [];
  const favName = extractFavoriteFromThead(html);
  const rows = extractTbodyRows(html);

  if (favName)
    result.push({ virtualIndex: -1, tbodyIndex: -1, nome: favName, isActive: true });

  for (const row of rows) {
    if (favName && row.nome.toLowerCase().trim() === favName.toLowerCase().trim()) continue;
    result.push({ virtualIndex: row.indice, tbodyIndex: row.indice, nome: row.nome, isActive: false });
  }

  return result;
}
