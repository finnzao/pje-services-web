const PJE_BASE = 'https://pje.tjba.jus.br';
const PJE_REST_BASE = `${PJE_BASE}/pje/seam/resource/rest/pje-legacy`;
const PJE_FRONTEND_ORIGIN = 'https://frontend.cloud.pje.jus.br';
const PJE_LEGACY_APP = 'pje-tjba-1g';

export interface PjeSession { cookies: Record<string, string>; idUsuarioLocalizacao: string; idUsuario?: number; }

export function serializeCookies(cookies: Record<string, string>, domainFilter?: string): string {
  const result: string[] = []; const seen = new Set<string>();
  for (const [key, value] of Object.entries(cookies)) {
    const sepIdx = key.indexOf('::');
    if (sepIdx > 0) { const domain = key.slice(0, sepIdx); const name = key.slice(sepIdx + 2); if (domainFilter && domain !== domainFilter) continue; if (name && !seen.has(name)) { seen.add(name); result.push(`${name}=${value}`); } }
    else { if (key && !seen.has(key)) { seen.add(key); result.push(`${key}=${value}`); } }
  }
  return result.join('; ');
}
export function serializeAllCookies(cookies: Record<string, string>): string { return serializeCookies(cookies); }
export function serializePjeCookies(cookies: Record<string, string>): string { return serializeCookies(cookies, 'pje.tjba.jus.br'); }
export function buildPjeHeaders(session: PjeSession): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-pje-legacy-app': PJE_LEGACY_APP, Origin: PJE_FRONTEND_ORIGIN, Referer: `${PJE_FRONTEND_ORIGIN}/`, 'X-pje-cookies': serializeAllCookies(session.cookies), 'X-pje-usuario-localizacao': session.idUsuarioLocalizacao };
}
export async function pjeApiGet<T>(session: PjeSession, endpoint: string): Promise<T> {
  const cookieStr = serializePjeCookies(session.cookies);
  const res = await fetch(`${PJE_REST_BASE}/${endpoint}`, { method: 'GET', headers: { ...buildPjeHeaders(session), Cookie: cookieStr } });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}
export async function pjeApiPost<T>(session: PjeSession, endpoint: string, body: unknown): Promise<T> {
  const cookieStr = serializePjeCookies(session.cookies);
  const res = await fetch(`${PJE_REST_BASE}/${endpoint}`, { method: 'POST', headers: { ...buildPjeHeaders(session), Cookie: cookieStr }, body: JSON.stringify(body) });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}
export { PJE_BASE, PJE_REST_BASE, PJE_FRONTEND_ORIGIN, PJE_LEGACY_APP };
