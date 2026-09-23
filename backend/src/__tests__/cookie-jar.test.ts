import { describe, expect, it, vi } from 'vitest';
import { CookieJar } from '../modules/pje-download/services/pje-auth/cookie-jar';

function resposta(setCookies: string[]): Response {
  const headers = new Headers();
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(null, { headers });
}

describe('CookieJar', () => {
  it('remove cookies expirados pelo servidor e mantém os demais', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const jar = new CookieJar();
    jar.extractFromResponse(resposta(['JSESSIONID=abc.pje1gapp018; Path=/pje', 'OAuth_Token_Request_State=x; Path=/', 'KC_RESTART=y']), 'https://pje.tjba.jus.br/pje/login.seam');
    jar.extractFromResponse(resposta([
      'OAuth_Token_Request_State=; Max-Age=0; Path=/',
      'KC_RESTART=; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'FADC_PJE=pje1gapp018|a; Expires=Wed, 01 Jan 2099 00:00:00 GMT',
    ]), 'https://pje.tjba.jus.br/pje/login.seam');

    expect(jar.serializeForDomain('https://pje.tjba.jus.br/pje/ng2/dev.seam')).toBe('JSESSIONID=abc.pje1gapp018; FADC_PJE=pje1gapp018|a');
  });
});
