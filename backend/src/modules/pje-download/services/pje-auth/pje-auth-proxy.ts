import { CookieJar } from './cookie-jar';
import { PJEHttpClient } from './http-client';
import {
  sessionStore, generateSessionId,
  getPersistedSession, savePersistedSession, clearPersistedSession,
} from './session-store';
import {
  extractProfilesFromHtml, extractVisibleIndices,
  hasPagination, extractScrollerInfo, extractTotalPages,
  extractCurrentPage, getPageForIndex,
} from './profile-extractor';
import {
  extractFormFields, extractViewState,
  detect2FA, extractLoginError, isLoggedInUrl, isProfileSelectionPage,
  isLoginFormReappearing,
} from './html-parser';
import { PJE_BASE } from './constants';
import type { PJELoginResult, PJEProfileResult, PJEUserInfo } from './types';

/** Número máximo de retries quando o SSO re-exibe o formulário de login */
const MAX_LOGIN_RETRIES = 3;
/** Delay entre retries (ms) para dar tempo ao SSO estabilizar a sessão */
const LOGIN_RETRY_DELAY = 3000;

export class PJEAuthProxy {
  private cookieJar = new CookieJar();
  private http = new PJEHttpClient(this.cookieJar);
  private idUsuarioLocalizacao = '';
  private idUsuario: number | undefined;
  private cpf = '';

  async login(cpf: string, password: string): Promise<PJELoginResult> {
    this.cpf = cpf;
    try {
      const reused = await this.tryReusePersistedSession(cpf);
      if (reused) return reused;

      return await this.performFreshLogin(cpf, password);
    } catch (err) {
      console.error(`[PJE-AUTH] Exception:`, err);
      return { needs2FA: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
    }
  }

  /**
   * Executa login completo com retry automático.
   */
  private async performFreshLogin(cpf: string, password: string): Promise<PJELoginResult> {
    for (let attempt = 0; attempt <= MAX_LOGIN_RETRIES; attempt++) {
      if (attempt > 0) {
        console.log(`[PJE-AUTH] Retry ${attempt}/${MAX_LOGIN_RETRIES}: SSO re-exibiu formulário de login, tentando novamente...`);
        this.cookieJar.clear();
        console.log(`[PJE-AUTH] Todos os cookies limpos para retry limpo`);
        await this.sleep(LOGIN_RETRY_DELAY);
      }

      // Fase 1: GET login.seam → redireciona para SSO
      console.log(`[PJE-AUTH] Step 1: GET ${PJE_BASE}/pje/login.seam${attempt > 0 ? ` (tentativa ${attempt + 1})` : ''}`);
      const ssoPage = await this.http.followRedirects('GET', `${PJE_BASE}/pje/login.seam`);
      console.log(`[PJE-AUTH] Step 1 done: finalUrl=${ssoPage.finalUrl} (${ssoPage.body.length} chars)`);

      // If on retry the SSO already recognizes the session and redirects to PJE
      if (attempt > 0 && isLoggedInUrl(ssoPage.finalUrl)) {
        console.log(`[PJE-AUTH] Retry ${attempt}: SSO redirecionou direto para PJE (sessão reconhecida)`);
        return await this.handleLoginResult(ssoPage);
      }

      const pjeCookiesBeforeSSO = this.cookieJar.snapshotDomain('pje.tjba.jus.br');
      console.log(`[PJE-AUTH] Cookies PJE salvos antes do POST SSO: ${Object.keys(pjeCookiesBeforeSSO).join(', ')}`);

      // Fase 2: POST credenciais
      const loginResult = await this.submitCredentials(ssoPage, cpf, password);
      if (!loginResult) return { needs2FA: false, error: 'Formulário SSO não encontrado.' };

      if (isLoginFormReappearing(loginResult.body, loginResult.finalUrl)) {

        const errorMsg = extractLoginError(loginResult.body);
        if (errorMsg) {
          console.log(`[PJE-AUTH] SSO retornou erro explícito: ${errorMsg}`);
          return { needs2FA: false, error: errorMsg };
        }

        // No explicit error = transient session issue
        if (attempt < MAX_LOGIN_RETRIES) {
          console.log(`[PJE-AUTH] SSO re-exibiu formulário de login sem erro — sessão transitória detectada`);
          continue; 
        }

        console.error(`[PJE-AUTH] SSO re-exibiu formulário de login após ${MAX_LOGIN_RETRIES + 1} tentativas`);
        return { needs2FA: false, error: 'Falha no login após múltiplas tentativas. O SSO pode estar instável. Tente novamente em alguns minutos.' };
      }


      return await this.handleLoginResult(loginResult);
    }

    return { needs2FA: false, error: 'Falha inesperada no login.' };
  }

  async submit2FA(sessionId: string, code: string): Promise<PJELoginResult> {
    try {
      const stored = sessionStore.get(sessionId);
      if (!stored) return { needs2FA: false, error: 'Sessão 2FA expirada.' };

      this.restoreFromSession(stored);

      const formData = extractFormFields(stored.ssoHtml || '', stored.ssoFinalUrl || '');
      if (!formData.actionUrl) return { needs2FA: false, error: 'Formulário 2FA não encontrado.' };

      const postFields: Record<string, string> = { ...formData.fields, code };

      try {
        const ssoUrl = new URL(stored.ssoFinalUrl || '');
        for (const p of ['session_code', 'execution', 'client_id', 'tab_id']) {
          const v = ssoUrl.searchParams.get(p);
          if (v) postFields[p] = v;
        }
      } catch { }

      const result = await this.http.followRedirects('POST', formData.actionUrl, new URLSearchParams(postFields));
      sessionStore.delete(sessionId);

      return await this.handleLoginResult(result);
    } catch (err) {
      return { needs2FA: false, error: err instanceof Error ? err.message : 'Erro no 2FA' };
    }
  }

  async selectProfile(sessionId: string, profileIndex: number): Promise<PJEProfileResult> {
    try {
      const stored = sessionStore.get(sessionId);
      if (!stored) return emptyResult('SESSION_EXPIRED');

      this.restoreFromSession(stored);

      // GET página de perfis
      const profilePage = await this.http.followRedirects('GET', `${PJE_BASE}/pje/ng2/dev.seam`);

      // Sessão expirada
      if (this.isSSO(profilePage.finalUrl)) {
        console.error(`[PJE-AUTH] Sessão expirada → SSO: ${profilePage.finalUrl}`);
        if (this.cpf) clearPersistedSession(this.cpf);
        sessionStore.delete(sessionId);
        return emptyResult('SESSION_EXPIRED');
      }

      let html = profilePage.body;
      let currentUrl = profilePage.finalUrl;

      // Garante que estamos na página de perfis
      if (!isProfileSelectionPage(html)) {
        console.log(`[PJE-AUTH] URL "${currentUrl}" sem papeisUsuarioForm, tentando dev.seam direto`);
        const retry = await this.http.followRedirects('GET', `${PJE_BASE}/pje/ng2/dev.seam`);
        if (!this.isSSO(retry.finalUrl)) {
          html = retry.body;
          currentUrl = retry.finalUrl;
        }
      }

      let viewState = extractViewState(html);
      if (!viewState) {
        console.error(`[PJE-AUTH] ViewState não encontrado. URL: ${currentUrl}`);
        if (this.cpf) clearPersistedSession(this.cpf);
        sessionStore.delete(sessionId);
        return emptyResult('SESSION_EXPIRED');
      }

      // Navega para a página correta se o índice não estiver visível
      if (profileIndex >= 0) {
        const visibleIndices = extractVisibleIndices(html);
        const targetPage = getPageForIndex(profileIndex);
        const currentPage = extractCurrentPage(html);
        const totalPages = extractTotalPages(html);

        console.log(`[PJE-AUTH] Índices visíveis: [${visibleIndices.join(', ')}]`);
        console.log(`[PJE-AUTH] Índice ${profileIndex} → página ${targetPage} (atual: ${currentPage}, total: ${totalPages})`);

        if (!visibleIndices.includes(profileIndex) && hasPagination(html)) {
          const navResult = await this.navigateToPage(html, viewState, targetPage);
          if (navResult) {
            html = navResult.html;
            viewState = navResult.viewState;
          } else {
            console.warn(`[PJE-AUTH] Não conseguiu navegar para página ${targetPage}`);
          }
        }
      }

      // Executa seleção de perfil
      await this.executeProfileSelection(html, viewState, profileIndex);

      // Valida troca de contexto
      const user = await this.fetchCurrentUser();
      if (user?.idUsuarioLocalizacaoMagistradoServidor) {
        this.idUsuarioLocalizacao = String(user.idUsuarioLocalizacaoMagistradoServidor);
        this.idUsuario = user.idUsuario;
        console.log(`[PJE-AUTH] idUsuarioLocalizacao: ${this.idUsuarioLocalizacao}`);
      }

      // Persiste sessão atualizada
      stored.cookies = this.cookieJar.exportAll();
      stored.idUsuarioLocalizacao = this.idUsuarioLocalizacao;
      stored.idUsuario = this.idUsuario;
      this.persistSession(user);

      return await this.fetchTasksAndTags();
    } catch (err) {
      console.error('[PJE-AUTH] Erro em selectProfile:', err);
      return emptyResult(err instanceof Error ? err.message : 'Erro ao selecionar perfil');
    }
  }

  // Navega para uma página específica do scroller RichFaces
  private async navigateToPage(
    html: string,
    currentViewState: string,
    targetPage: number,
  ): Promise<{ html: string; viewState: string } | null> {
    const scrollerInfo = extractScrollerInfo(html);
    if (!scrollerInfo) {
      console.warn('[PJE-AUTH] Scroller não encontrado para paginação');
      return null;
    }

    console.log(`[PJE-AUTH] Navegando para página ${targetPage} via scroller: ${scrollerInfo.scrollerId}`);

    const body = new URLSearchParams({
      'AJAXREQUEST': '_viewRoot',
      [scrollerInfo.formId]: scrollerInfo.formId,
      [scrollerInfo.scrollerId]: String(targetPage),
      'ajaxSingle': scrollerInfo.scrollerId,
      'javax.faces.ViewState': currentViewState,
    });

    const result = await this.http.followRedirects('POST', `${PJE_BASE}/pje/ng2/dev.seam`, body);
    console.log(`[PJE-AUTH] Paginação → status=${result.status}, url=${result.finalUrl}`);

    const newViewState = extractViewState(result.body);
    if (!newViewState) {
      console.warn('[PJE-AUTH] ViewState não encontrado após paginação');
      return null;
    }

    const visibleAfter = extractVisibleIndices(result.body);
    console.log(`[PJE-AUTH] Índices após paginação: [${visibleAfter.join(', ')}]`);

    return { html: result.body, viewState: newViewState };
  }

  // Lista TODOS os perfis de TODAS as páginas
  async getAllProfiles(sessionId: string): Promise<PJELoginResult> {
    const stored = sessionStore.get(sessionId);
    if (!stored) return { needs2FA: false, error: 'Sessão não encontrada.' };

    this.restoreFromSession(stored);

    const firstPage = await this.http.followRedirects('GET', `${PJE_BASE}/pje/ng2/dev.seam`);
    if (this.isSSO(firstPage.finalUrl))
      return { needs2FA: false, error: 'SESSION_EXPIRED' };

    let html = firstPage.body;
    let viewState = extractViewState(html) || '';
    const allProfiles = extractProfilesFromHtml(html);
    const totalPages = extractTotalPages(html);

    console.log(`[PJE-AUTH] Total de páginas: ${totalPages}`);

    for (let page = 2; page <= totalPages; page++) {
      const nav = await this.navigateToPage(html, viewState, page);
      if (!nav) break;
      html = nav.html;
      viewState = nav.viewState;

      const pageProfiles = extractProfilesFromHtml(html);
      for (const p of pageProfiles) {
        if (!allProfiles.find(x => x.indice === p.indice)) allProfiles.push(p);
      }
    }

    console.log(`[PJE-AUTH] ${allProfiles.length} perfis disponíveis`, JSON.stringify(allProfiles, null, 2));

    stored.cookies = this.cookieJar.exportAll();
    sessionStore.set(sessionId, stored);

    return { needs2FA: false, sessionId, profiles: allProfiles };
  }

  async debugGetProfilesHtml(sessionId: string): Promise<string> {
    const stored = sessionStore.get(sessionId);
    if (!stored) return '<h1>Sessão não encontrada</h1>';
    this.restoreFromSession(stored);
    const r = await this.http.followRedirects('GET', `${PJE_BASE}/pje/ng2/dev.seam`);
    return `<!-- URL: ${r.finalUrl} -->\n${r.body}`;
  }

  // ─── Métodos privados ──────────────────────────────────────────

  private async tryReusePersistedSession(cpf: string): Promise<PJELoginResult | null> {
    const persisted = getPersistedSession(cpf);
    if (!persisted) return null;

    console.log(`[PJE-AUTH] Sessão persistida para ***${cpf.slice(-4)}, validando...`);
    this.cookieJar.importAll(persisted.cookies);
    this.idUsuarioLocalizacao = persisted.idUsuarioLocalizacao;
    this.idUsuario = persisted.idUsuario;

    const user = await this.fetchCurrentUser();
    if (!user?.idUsuario || user.idUsuario === 0) {
      console.log(`[PJE-AUTH] Sessão persistida expirada`);
      clearPersistedSession(cpf);
      this.cookieJar.clear();
      return null;
    }

    console.log(`[PJE-AUTH] Sessão persistida válida: ${user.nomeUsuario}`);
    this.idUsuarioLocalizacao = String(user.idUsuarioLocalizacaoMagistradoServidor || '');
    this.idUsuario = user.idUsuario;

    const sid = generateSessionId();
    sessionStore.set(sid, {
      cookies: this.cookieJar.exportAll(),
      idUsuarioLocalizacao: this.idUsuarioLocalizacao,
      idUsuario: this.idUsuario,
      cpf: this.cpf,
    });
    savePersistedSession(cpf, {
      cookies: this.cookieJar.exportAll(),
      idUsuarioLocalizacao: this.idUsuarioLocalizacao,
      idUsuario: this.idUsuario,
      user: this.mapUser(user),
    });

    const profileResult = await this.getAllProfiles(sid);
    return {
      needs2FA: false,
      sessionId: sid,
      user: this.mapUser(user),
      profiles: profileResult.profiles || [],
    };
  }

  private async submitCredentials(
    ssoPage: { body: string; finalUrl: string },
    cpf: string,
    password: string,
  ) {
    const formData = extractFormFields(ssoPage.body, ssoPage.finalUrl);
    if (!formData.actionUrl) {
      console.error(`[PJE-AUTH] Form SSO não encontrado em: ${ssoPage.finalUrl}`);
      return null;
    }

    const postFields = { ...formData.fields, username: cpf, password };
    console.log(`[PJE-AUTH] Step 2: POST to ${formData.actionUrl.substring(0, 100)}...`);

    const result = await this.http.followRedirects('POST', formData.actionUrl, new URLSearchParams(postFields));
    console.log(`[PJE-AUTH] Step 2 done: finalUrl=${result.finalUrl} (status=${result.status})`);
    return result;
  }

  private async handleLoginResult(result: { body: string; finalUrl: string; status: number }): Promise<PJELoginResult> {
    // Detecta 2FA (ainda no SSO)
    if (detect2FA(result.body, result.finalUrl)) {
      const sid = generateSessionId();
      sessionStore.set(sid, {
        cookies: this.cookieJar.exportAll(),
        idUsuarioLocalizacao: this.idUsuarioLocalizacao,
        idUsuario: this.idUsuario,
        ssoHtml: result.body,
        ssoFinalUrl: result.finalUrl,
        cpf: this.cpf,
      });
      console.log(`[PJE-AUTH] 2FA detectado`);
      return { needs2FA: true, sessionId: sid };
    }

    // Voltou para form SSO = credenciais inválidas
    if (result.finalUrl.includes('sso.cloud.pje.jus.br/auth/realms')) {
      const errorMsg = extractLoginError(result.body);
      if (errorMsg) return { needs2FA: false, error: errorMsg };
      if (result.body.includes('kc-form-login') || result.body.includes('username'))
        return { needs2FA: false, error: 'CPF ou senha incorretos.' };
    }

    // Chegou ao PJE
    if (isLoggedInUrl(result.finalUrl)) {
      console.log(`[PJE-AUTH] Login OK — URL: ${result.finalUrl}`);
      return await this.validateAndBuildResponse();
    }

    const errorMsg = extractLoginError(result.body);
    if (errorMsg) return { needs2FA: false, error: errorMsg };

    console.error(`[PJE-AUTH] Login falhou. URL: ${result.finalUrl}`);
    return { needs2FA: false, error: 'Falha no login. Verifique CPF e senha.' };
  }

  private async validateAndBuildResponse(): Promise<PJELoginResult> {
    const user = await this.fetchCurrentUser();
    if (!user?.idUsuario || user.idUsuario === 0) {
      console.error('[PJE-AUTH] currentUser inválido. Cookies:', this.cookieJar.summary());
      return { needs2FA: false, error: 'Sessão inválida após login.' };
    }

    this.idUsuarioLocalizacao = String(user.idUsuarioLocalizacaoMagistradoServidor || '');
    this.idUsuario = user.idUsuario;
    console.log(`[PJE-AUTH] Usuário: ${user.nomeUsuario}, localizacao: ${this.idUsuarioLocalizacao}`);

    const sid = generateSessionId();
    sessionStore.set(sid, {
      cookies: this.cookieJar.exportAll(),
      idUsuarioLocalizacao: this.idUsuarioLocalizacao,
      idUsuario: this.idUsuario,
      cpf: this.cpf,
    });
    this.persistSession(user);

    const profileResult = await this.getAllProfiles(sid);

    return {
      needs2FA: false,
      sessionId: sid,
      user: this.mapUser(user),
      profiles: profileResult.profiles || [],
    };
  }

  private async executeProfileSelection(html: string, viewState: string, profileIndex: number): Promise<void> {
    let elementId: string;

    if (profileIndex === -1) {
      elementId = 'papeisUsuarioForm:dtPerfil:j_id66';
    } else {
      elementId = `papeisUsuarioForm:dtPerfil:${profileIndex}:j_id70`;
    }

    if (!html.includes(elementId)) {
      console.warn(`[PJE-AUTH] element_id "${elementId}" não encontrado no HTML`);
      const altId = `papeisUsuarioForm:dtPerfil:${profileIndex}:j_id68`;
      if (html.includes(altId)) {
        console.log(`[PJE-AUTH] Usando fallback j_id68: ${altId}`);
        elementId = altId;
      } else {
        console.warn(`[PJE-AUTH] Nenhum element_id válido encontrado, tentando mesmo assim`);
      }
    }

    console.log(`[PJE-AUTH] Selecionando perfil: ${elementId}`);

    const body = new URLSearchParams({
      'papeisUsuarioForm': 'papeisUsuarioForm',
      'papeisUsuarioForm:j_id60': '',
      'papeisUsuarioForm:j_id72': 'papeisUsuarioForm:j_id72',
      'javax.faces.ViewState': viewState,
      [elementId]: elementId,
    });

    const result = await this.http.followRedirects('POST', `${PJE_BASE}/pje/ng2/dev.seam`, body);
    console.log(`[PJE-AUTH] Seleção POST finalUrl: ${result.finalUrl}`);

    if (result.body.includes('Ajax-Response') && result.body.includes('login.seam'))
      throw new Error('SESSION_EXPIRED');
  }

  private async fetchTasksAndTags(): Promise<PJEProfileResult> {
    const [tasks, favoriteTasks, tagsResult] = await Promise.all([
      this.http.apiPost<any[]>('painelUsuario/tarefas',
        { numeroProcesso: '', competencia: '', etiquetas: [] },
        this.idUsuarioLocalizacao).catch(() => []),
      this.http.apiPost<any[]>('painelUsuario/tarefasFavoritas',
        { numeroProcesso: '', competencia: '', etiquetas: [] },
        this.idUsuarioLocalizacao).catch(() => []),
      this.http.apiPost<{ entities: any[] }>('painelUsuario/etiquetas',
        { page: 0, maxResults: 500, tagsString: '' },
        this.idUsuarioLocalizacao).catch(() => ({ entities: [] })),
    ]);

    const taskList = Array.isArray(tasks) ? tasks : [];
    const favList = Array.isArray(favoriteTasks) ? favoriteTasks : [];
    const tagList = tagsResult?.entities || [];

    console.log(`[PJE-AUTH] Resultado: ${taskList.length} tarefas, ${favList.length} favoritas, ${tagList.length} etiquetas`);
    return { tasks: taskList, favoriteTasks: favList, tags: tagList };
  }

  private async fetchCurrentUser(): Promise<any> {
    try { return await this.http.apiGet<any>('usuario/currentUser', this.idUsuarioLocalizacao); }
    catch { return null; }
  }

  private isSSO(url: string): boolean {
    return url.includes('sso.cloud.pje.jus.br') ||
      url.includes('openid-connect/auth') ||
      url.includes('/auth/realms/');
  }

  private restoreFromSession(stored: {
    cookies: Record<string, string>;
    idUsuarioLocalizacao: string;
    idUsuario?: number;
    cpf?: string;
  }): void {
    this.cookieJar.importAll(stored.cookies);
    this.idUsuarioLocalizacao = stored.idUsuarioLocalizacao;
    this.idUsuario = stored.idUsuario;
    this.cpf = stored.cpf || '';
  }

  private persistSession(user?: any): void {
    if (!this.cpf) return;
    savePersistedSession(this.cpf, {
      cookies: this.cookieJar.exportAll(),
      idUsuarioLocalizacao: this.idUsuarioLocalizacao,
      idUsuario: this.idUsuario ?? user?.idUsuario,
      user: user ? this.mapUser(user) : undefined,
    });
  }

  private mapUser(raw: any): PJEUserInfo {
    return {
      idUsuario: raw.idUsuario,
      nomeUsuario: raw.nomeUsuario,
      login: raw.login,
      perfil: raw.perfil || raw.nomePerfil || '',
      nomePerfil: raw.nomePerfil || raw.perfil || '',
      idUsuarioLocalizacaoMagistradoServidor: raw.idUsuarioLocalizacaoMagistradoServidor,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function emptyResult(error: string): PJEProfileResult {
  return { tasks: [], favoriteTasks: [], tags: [], error };
}