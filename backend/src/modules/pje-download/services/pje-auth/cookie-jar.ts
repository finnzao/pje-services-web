export class CookieJar {
  private jar = new Map<string, Record<string, string>>();

  private getDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return 'unknown'; }
  }

  extractFromResponse(res: Response, requestUrl: string): void {
    const domain = this.getDomain(requestUrl);
    const setCookieHeaders: string[] = (res.headers as any).getSetCookie?.() || [];

    if (setCookieHeaders.length === 0) {
      const raw = res.headers.get('set-cookie');
      if (raw) setCookieHeaders.push(...raw.split(/,(?=\s*\w+=)/));
    }

    if (setCookieHeaders.length === 0) return;

    if (!this.jar.has(domain)) this.jar.set(domain, {});
    const domainCookies = this.jar.get(domain)!;
    const newCookies: string[] = [];

    for (const raw of setCookieHeaders) {
      const [pair] = raw.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const name = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        if (name && !name.startsWith('__')) {
          domainCookies[name] = value;
          newCookies.push(name);
        }
      }
    }

    if (newCookies.length > 0)
      console.log(`[PJE-AUTH]     cookies set by ${domain}: ${newCookies.join(', ')}`);
  }

  // Cookies apenas do domínio solicitado (para header Cookie)
  serializeForDomain(url: string): string {
    const requestDomain = this.getDomain(url);
    const allCookies: Record<string, string> = {};
    for (const [domain, cookies] of this.jar) {
      if (requestDomain === domain || requestDomain.endsWith('.' + domain))
        Object.assign(allCookies, cookies);
    }
    return Object.entries(allCookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  // Todos os cookies de todos os domínios (para X-pje-cookies)
  serializeAll(): string {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const cookies of this.jar.values()) {
      for (const [name, value] of Object.entries(cookies)) {
        if (!seen.has(name)) {
          seen.add(name);
          parts.push(`${name}=${value}`);
        }
      }
    }
    return parts.join('; ');
  }

  getCookie(domain: string, name: string): string | undefined {
    return this.jar.get(domain)?.[name];
  }

  setCookie(domain: string, name: string, value: string): void {
    if (!this.jar.has(domain)) this.jar.set(domain, {});
    this.jar.get(domain)![name] = value;
  }

  /**
   * Takes a snapshot of all cookies for a specific domain.
   * Useful for saving OAuth state cookies before SSO POST.
   */
  snapshotDomain(domain: string): Record<string, string> {
    const cookies = this.jar.get(domain);
    return cookies ? { ...cookies } : {};
  }

  /**
   * Restores cookies for a specific domain from a snapshot,
   * overwriting any current cookies for that domain.
   */
  restoreDomain(domain: string, snapshot: Record<string, string>): void {
    if (Object.keys(snapshot).length > 0) {
      this.jar.set(domain, { ...snapshot });
      console.log(`[PJE-AUTH] Cookies do domínio ${domain} restaurados: ${Object.keys(snapshot).join(', ')}`);
    }
  }

  exportAll(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [domain, cookies] of this.jar)
      for (const [name, value] of Object.entries(cookies))
        result[`${domain}::${name}`] = value;
    return result;
  }

  importAll(flat: Record<string, string>): void {
    for (const [key, value] of Object.entries(flat)) {
      const sepIdx = key.indexOf('::');
      if (sepIdx > 0) {
        const domain = key.slice(0, sepIdx);
        const name = key.slice(sepIdx + 2);
        if (!this.jar.has(domain)) this.jar.set(domain, {});
        this.jar.get(domain)![name] = value;
      } else {
        if (!this.jar.has('pje.tjba.jus.br')) this.jar.set('pje.tjba.jus.br', {});
        this.jar.get('pje.tjba.jus.br')![key] = value;
      }
    }
  }

  summary(): string {
    const parts: string[] = [];
    for (const [domain, cookies] of this.jar)
      parts.push(`${domain}(${Object.keys(cookies).join(',')})`);
    return parts.join(' | ');
  }

  get size(): number {
    let count = 0;
    for (const cookies of this.jar.values()) count += Object.keys(cookies).length;
    return count;
  }

  /**
   * Limpa cookies de um domínio específico, preservando cookies de outros domínios.
   */
  clearDomain(domain: string): void {
    const deleted = this.jar.delete(domain);
    if (deleted) {
      console.log(`[PJE-AUTH] Cookies do domínio ${domain} limpos`);
    }
  }

  clear(): void {
    this.jar.clear();
  }
}