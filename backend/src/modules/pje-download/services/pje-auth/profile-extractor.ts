import type { PJEProfile } from './types';
import { decodeHtmlEntities, stripHtml } from './html-parser';

export const PJE_PROFILES_PER_PAGE = 5;

// Ids j_idNN mudam a cada deploy do PJE; tudo aqui é derivado de âncoras estáveis
// (dtPerfil, perfilInicial, colPerfil, scPerfil, jsfcljs).
const JSFCLJS_ID = /jsfcljs\([^{]*\{'([^']+)'/;

interface Row { indice: number; nome: string; favorito: boolean; selectId: string; }

export function extractProfilesFromHtml(html: string): PJEProfile[] {
  const profiles: PJEProfile[] = [];
  const fav = extractFavoriteFromThead(html);
  const rows = extractTbodyRows(html);

  if (fav) profiles.push({ indice: -1, nome: fav.nome, orgao: orgaoOf(fav.nome), favorito: true });

  for (const row of rows) {
    if (fav && sameName(row.nome, fav.nome)) continue;
    profiles.push({ indice: row.indice, nome: row.nome, orgao: orgaoOf(row.nome), favorito: row.favorito });
  }

  console.log(`[PJE-AUTH] Perfis na página: ${profiles.length}`);
  for (const p of profiles) console.log(`  [${p.indice}] ${p.favorito ? '⭐' : '  '} ${p.nome}`);
  return profiles;
}

export function extractVisibleIndices(html: string): number[] {
  return extractTbodyRows(html).map(r => r.indice);
}

export function hasPagination(html: string): boolean {
  return html.includes('scPerfil');
}

export function extractScrollerInfo(html: string): { formId: string; scrollerId: string } | null {
  const m = html.match(/id="([^"]*:scPerfil)"/);
  if (!m) return null;
  return { formId: m[1].replace(/:scPerfil$/, ''), scrollerId: m[1] };
}

export function extractTotalPages(html: string): number {
  const nums = [...html.matchAll(/rich-datascr-(?:act|inact)[^>]*>(\d+)</g)].map(m => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 1;
}

export function extractCurrentPage(html: string): number {
  const m = html.match(/rich-datascr-act[^>]*>(\d+)</);
  return m ? parseInt(m[1], 10) : 1;
}

export function getPageForIndex(profileIndex: number): number {
  if (profileIndex < 0) return 1;
  return Math.floor(profileIndex / PJE_PROFILES_PER_PAGE) + 1;
}

// Id JSF do link que seleciona o perfil (-1 = favorito do thead)
export function extractProfileSelectId(html: string, profileIndex: number): string | null {
  if (profileIndex === -1) return extractFavoriteFromThead(html)?.selectId ?? null;
  return extractTbodyRows(html).find(r => r.indice === profileIndex)?.selectId ?? null;
}

// Campos ocultos/texto do papeisUsuarioForm que o JSF espera no POST (exceto ViewState)
export function extractProfileFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]+name="(papeisUsuarioForm[^"]*)"[^>]*>/gi)) {
    const value = m[0].match(/value="([^"]*)"/)?.[1] ?? '';
    fields[m[1]] = value;
  }
  return fields;
}

function orgaoOf(nome: string): string {
  return nome.split(' / ')[1]?.trim() || '';
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function linkText(html: string): string {
  return decodeHtmlEntities(stripHtml(html).trim());
}

function extractTbodyRows(html: string): Row[] {
  const rows: Row[] = [];
  const tbody = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)]
    .map(m => m[1]).find(b => b.includes('colPerfil'));
  if (!tbody) return rows;

  for (const [, row] of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const idx = row.match(/dtPerfil:(\d+):(?:colPerfil|perfilInicial)/);
    if (!idx) continue;
    const cell = row.match(/colPerfil[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '';
    const link = cell.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const nome = linkText(link[1]);
    if (nome.length < 3) continue;
    const favImg = row.match(/favorite-16x16(-disabled)?\.png/);
    rows.push({
      indice: parseInt(idx[1], 10),
      nome,
      favorito: favImg ? !favImg[1] : false,
      selectId: link[0].match(JSFCLJS_ID)?.[1] ?? '',
    });
  }
  return rows.sort((a, b) => a.indice - b.indice);
}

function extractFavoriteFromThead(html: string): { nome: string; selectId: string } | null {
  const thead = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1];
  if (!thead || !thead.includes('favorite-16x16.png') || thead.includes('favorite-16x16-disabled.png')) return null;

  for (const m of thead.matchAll(/<a[^>]*jsfcljs[^>]*>([\s\S]*?)<\/a>/gi)) {
    const nome = linkText(m[1]);
    if (nome.length > 3) return { nome, selectId: m[0].match(JSFCLJS_ID)?.[1] ?? '' };
  }
  return null;
}
