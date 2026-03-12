import { CookieJar } from './cookie-jar';
import { PJE_REST_BASE, PJE_FRONTEND_ORIGIN, PJE_LEGACY_APP, MAX_REDIRECTS } from './constants';
import { resolveUrl } from './html-parser';
import type { FollowRedirectsResult } from './types';

export class PJEHttpClient {
  constructor(private cookieJar: CookieJar) {}

  async followRedirects(
    method: 'GET' | 'POST',
    url: string,
    body?: URLSearchParams,
  ): Promise<FollowRedirectsResult> {
    let currentUrl = url;
    let currentMethod = method;
    let currentBody: URLSearchParams | undefined = body;

    // FIX: Track visited URLs to detect redirect loops
    const visitedUrls = new Set<string>();
    let loopDetected = false;

    for (let i = 0; i < MAX_REDIRECTS; i++) {
      const cookieStr = this.cookieJar.serializeForDomain(currentUrl);

      if (i <= 8) {
        const domain = safeDomain(currentUrl);
        const path = safePath(currentUrl);
        const cookieNames = cookieStr ? cookieStr.split('; ').map(c => c.split('=')[0]) : [];
        console.log(`[PJE-AUTH]     → ${currentMethod} ${domain}${path} cookies: [${cookieNames.join(', ')}]`);
      }

      const headers: Record<string, string> = {
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      };

      // Origin/Referer corretos conforme doc seção 3.1
      if (currentMethod === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        if (currentUrl.includes('sso.cloud.pje.jus.br')) {
          headers['Origin'] = 'https://sso.cloud.pje.jus.br';
          headers['Referer'] = currentUrl;
        } else {
          headers['Origin'] = 'https://pje.tjba.jus.br';
          headers['Referer'] = currentUrl;
        }
      }

      const res = await fetch(currentUrl, {
        method: currentMethod,
        headers,
        body: currentMethod === 'POST' && currentBody ? currentBody.toString() : undefined,
        redirect: 'manual',
      });

      this.cookieJar.extractFromResponse(res, currentUrl);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.text().catch(() => { });
        if (!location) break;

        let nextUrl = resolveUrl(location, currentUrl);

        // Preserva jsessionid da URL se presente
        const jsessionMatch = nextUrl.match(/;jsessionid=([^?&#]+)/);
        if (jsessionMatch) {
          const domain = safeDomain(nextUrl);
          this.cookieJar.setCookie(domain, 'JSESSIONID', jsessionMatch[1]);
          nextUrl = nextUrl.replace(/;jsessionid=[^?&#]+/, '');
        }

        console.log(`[PJE-AUTH]   redirect #${i + 1}: ${res.status} ${truncUrl(currentUrl)} → ${truncUrl(nextUrl)}`);

        // FIX: Detect redirect loops - if we're going back to SSO from PJE
        const urlKey = normalizeUrlForLoopDetection(nextUrl);
        if (visitedUrls.has(urlKey)) {
          console.warn(`[PJE-AUTH]   ⚠️ Loop detectado: já visitamos ${truncUrl(nextUrl)}`);
          loopDetected = true;
          // Don't break immediately - let it continue to get the final page
        }
        visitedUrls.add(normalizeUrlForLoopDetection(currentUrl));

        if (loopDetected && nextUrl.includes('sso.cloud.pje.jus.br') && currentUrl.includes('pje.tjba.jus.br')) {
          console.warn(`[PJE-AUTH]   ⚠️ Interrompendo cadeia de redirects (PJE→SSO loop)`);
          // Follow this last redirect to get the SSO page
          const loopRes = await fetch(nextUrl, {
            method: 'GET',
            headers: {
              'Cookie': this.cookieJar.serializeForDomain(nextUrl),
              'User-Agent': headers['User-Agent'],
              'Accept': headers['Accept'],
            },
            redirect: 'manual',
          });
          this.cookieJar.extractFromResponse(loopRes, nextUrl);

          if (loopRes.status >= 300 && loopRes.status < 400) {
            const finalLocation = loopRes.headers.get('location');
            await loopRes.text().catch(() => {});
            if (finalLocation) {
              const finalUrl = resolveUrl(finalLocation, nextUrl);
              const finalRes = await fetch(finalUrl, {
                method: 'GET',
                headers: {
                  'Cookie': this.cookieJar.serializeForDomain(finalUrl),
                  'User-Agent': headers['User-Agent'],
                  'Accept': headers['Accept'],
                },
                redirect: 'follow',
              });
              this.cookieJar.extractFromResponse(finalRes, finalUrl);
              const responseBody = await finalRes.text();
              return { body: responseBody, finalUrl: finalRes.url, status: finalRes.status };
            }
          }

          const responseBody = await loopRes.text();
          return { body: responseBody, finalUrl: loopRes.url || nextUrl, status: loopRes.status };
        }

        currentUrl = nextUrl;
        currentMethod = 'GET';
        currentBody = undefined;
        continue;
      }

      const responseBody = await res.text();
      return { body: responseBody, finalUrl: currentUrl, status: res.status };
    }
    throw new Error(`Excedido limite de ${MAX_REDIRECTS} redirects`);
  }

  async apiGet<T = any>(endpoint: string, idUsuarioLocalizacao: string): Promise<T> {
    const url = `${PJE_REST_BASE}/${endpoint}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.buildRestHeaders(idUsuarioLocalizacao),
      redirect: 'follow',
    });
    this.cookieJar.extractFromResponse(res, url);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  async apiPost<T = any>(endpoint: string, body: Record<string, unknown>, idUsuarioLocalizacao: string): Promise<T> {
    const url = `${PJE_REST_BASE}/${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildRestHeaders(idUsuarioLocalizacao),
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    this.cookieJar.extractFromResponse(res, url);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  // Headers conforme doc seção 6.1 — X-pje-cookies usa TODOS os cookies
  buildRestHeaders(idUsuarioLocalizacao: string): Record<string, string> {
    const domainCookies = this.cookieJar.serializeForDomain(PJE_REST_BASE);
    const allCookies = this.cookieJar.serializeAll();
    return {
      'Content-Type': 'application/json',
      'X-pje-legacy-app': PJE_LEGACY_APP,
      'Origin': PJE_FRONTEND_ORIGIN,
      'Referer': `${PJE_FRONTEND_ORIGIN}/`,
      'X-pje-cookies': allCookies,          // TODOS os cookies (SSO + PJE)
      'X-pje-usuario-localizacao': idUsuarioLocalizacao,
      'Cookie': domainCookies,              // apenas cookies do domínio
    };
  }
}

function safeDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return '?'; }
}

function safePath(url: string): string {
  try { return new URL(url).pathname.substring(0, 50); } catch { return ''; }
}

function truncUrl(url: string): string {
  try {
    const u = new URL(url);
    const search = u.search.length > 40 ? u.search.substring(0, 40) + '...' : u.search;
    return `${u.hostname}${u.pathname}${search}`;
  } catch { return url.substring(0, 100); }
}

function normalizeUrlForLoopDetection(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}