import { PJEAuthProxy, sessionStore } from './services/pje-auth';
import { PJEDownloadService } from './pje-download.service';
import type { IPJEDownloadRepository } from './pje-download.service';
import type {
  PJEJobStatus,
  PJEDownloadProgress,
  PJEDownloadedFile,
  PJEDownloadError as PJEDownloadErrorType,
  DownloadJobResponse,
} from '../../shared/types';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PJE_BASE = 'https://pje.tjba.jus.br';
const PJE_REST_BASE = `${PJE_BASE}/pje/seam/resource/rest/pje-legacy`;
const PJE_FRONTEND_ORIGIN = 'https://frontend.cloud.pje.jus.br';
const PJE_LEGACY_APP = 'pje-tjba-1g';

const POLL_INTERVAL = 3000;
const DOWNLOAD_DELAY = 2000;
const DOWNLOAD_POLL_INTERVAL = 10000;
const DOWNLOAD_POLL_INITIAL = 5000;
const DOWNLOAD_TIMEOUT = 600000;
const DOWNLOAD_BATCH_SIZE = 10;
const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');
const PAGE_SIZE = 500;

const DOWNLOAD_AVAILABLE_STATUSES = ['S', 'DISPONIVEL', 'AVAILABLE'];

export class PJEDownloadWorker {
  private running = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private processingJobs = new Set<string>();

  constructor(
    private service: PJEDownloadService,
    private repository: IPJEDownloadRepository,
  ) {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[PJE-WORKER] Worker iniciado — verificando jobs pendentes a cada 3s');
    this.intervalHandle = setInterval(() => this.checkPendingJobs(), POLL_INTERVAL);
    this.checkPendingJobs();
  }

  stop(): void {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log('[PJE-WORKER] Worker parado');
  }

  private async checkPendingJobs(): Promise<void> {
    if (!this.running) return;
    try {
      const { jobs } = await this.repository.findJobsByUser(1, 50, 0);
      const pending = jobs.filter((j) => j.status === 'pending' && !this.processingJobs.has(j.id));
      for (const job of pending) {
        this.processJob(job).catch((err) => {
          console.error(`[PJE-WORKER] Erro fatal no job ${job.id.slice(0, 8)}:`, err);
        });
      }
    } catch {
    }
  }

  private serializeCookies(cookies: Record<string, string>): string {
    const PJE_DOMAIN = 'pje.tjba.jus.br';
    const result: string[] = [];
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(cookies)) {
      const sepIdx = key.indexOf('::');
      if (sepIdx > 0) {
        const domain = key.slice(0, sepIdx);
        const name = key.slice(sepIdx + 2);
        if (domain === PJE_DOMAIN && name && !seen.has(name)) { seen.add(name); result.push(`${name}=${value}`); }
      } else {
        if (key && !seen.has(key)) { seen.add(key); result.push(`${key}=${value}`); }
      }
    }
    return result.join('; ');
  }

  private serializeAllCookies(cookies: Record<string, string>): string {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(cookies)) {
      const sepIdx = key.indexOf('::');
      const name = sepIdx > 0 ? key.slice(sepIdx + 2) : key;
      if (name && !seen.has(name)) { seen.add(name); result.push(`${name}=${value}`); }
    }
    return result.join('; ');
  }

  private async processJob(job: DownloadJobResponse): Promise<void> {
    const jobId = job.id;
    const shortId = jobId.slice(0, 8);
    if (this.processingJobs.has(jobId)) return;
    this.processingJobs.add(jobId);
    console.log(`[PJE-WORKER] ══════ Processando job ${shortId} | modo=${job.mode} ══════`);

    try {
      const params = (job as any).params || {};
      const credentials = params.credentials || {};
      const cpf = credentials.cpf || '';
      const password = credentials.password || '';

      if (!cpf || !password) { await this.failJob(jobId, 'Credenciais não encontradas no job.'); return; }

      await this.updateStatus(jobId, 'authenticating', 0, 'Autenticando no PJE...');

      const proxy = new PJEAuthProxy();
      const existingSessionId = params.pjeSessionId as string | undefined;
      let sessionId: string | undefined;

      if (existingSessionId) {
        const existingSession = sessionStore.get(existingSessionId);
        if (existingSession) { sessionId = existingSessionId; }
      }

      if (!sessionId) {
        const loginResult = await proxy.login(cpf, password);
        if (this.service.isCancelled(jobId)) return;
        if (loginResult.needs2FA) { await this.failJob(jobId, '2FA necessário. Faça login primeiro na interface.'); return; }
        if (loginResult.error || !loginResult.user) { await this.failJob(jobId, loginResult.error || 'Falha na autenticação.'); return; }
        sessionId = loginResult.sessionId!;

        const profileIndex = params.pjeProfileIndex ?? 0;
        await this.updateStatus(jobId, 'selecting_profile', 5, `Selecionando perfil #${profileIndex}...`);
        const profileResult = await proxy.selectProfile(sessionId, profileIndex);
        if (profileResult.error) { await this.failJob(jobId, `Erro ao selecionar perfil: ${profileResult.error}`); return; }
        if (this.service.isCancelled(jobId)) return;
      }

      if (!sessionId) { await this.failJob(jobId, 'Não foi possível obter sessão válida.'); return; }

      const stored = sessionStore.get(sessionId);
      if (!stored) { await this.failJob(jobId, 'Sessão não encontrada no store.'); return; }

      if (!stored.idUsuario) {
        try {
          const cookieStr = this.serializeCookies(stored.cookies);
          const allCookieStr = this.serializeAllCookies(stored.cookies);
          const res = await fetch(`${PJE_REST_BASE}/usuario/currentUser`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'X-pje-legacy-app': PJE_LEGACY_APP, 'Origin': PJE_FRONTEND_ORIGIN, 'Referer': `${PJE_FRONTEND_ORIGIN}/`, 'X-pje-cookies': allCookieStr, 'X-pje-usuario-localizacao': stored.idUsuarioLocalizacao, 'Cookie': cookieStr },
          });
          if (res.ok) {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('json')) { const user = await res.json() as any; if (user?.idUsuario) stored.idUsuario = user.idUsuario; }
          }
        } catch { /* silent */ }
      }

      await this.updateStatus(jobId, 'processing', 10, 'Listando processos...');

      interface ProcessoInfo { idProcesso: number; numeroProcesso: string; idTaskInstance?: number; }
      let processos: ProcessoInfo[] = [];

      switch (job.mode) {
        case 'by_number': {
          const numbers: string[] = params.processNumbers || [];
          for (const num of numbers) processos.push({ idProcesso: 0, numeroProcesso: num });
          break;
        }
        case 'by_task': {
          processos = await this.listProcessesByTask(stored, (params.taskName || '').trim(), params.isFavorite === true, jobId);
          break;
        }
        case 'by_tag': {
          if (params.tagId) processos = await this.listProcessesByTag(stored, params.tagId);
          break;
        }
      }

      if (this.service.isCancelled(jobId)) return;

      if (processos.length === 0) {
        await this.updateStatus(jobId, 'completed', 100, 'Nenhum processo encontrado.');
        await this.repository.updateJob({ id: jobId, status: 'completed', totalProcesses: 0, successCount: 0, completedAt: new Date() });
        return;
      }

      const total = processos.length;
      await this.repository.updateJob({ id: jobId, status: 'downloading', totalProcesses: total, startedAt: new Date() });

      const files: PJEDownloadedFile[] = [];
      const errors: PJEDownloadErrorType[] = [];
      let successCount = 0;
      let failureCount = 0;
      const pendingDownloads: Array<{ proc: ProcessoInfo; requestedAt: number }> = [];

      for (let i = 0; i < processos.length; i++) {
        if (this.service.isCancelled(jobId)) break;
        const proc = processos[i];
        const progressPct = 15 + Math.round((i / total) * 70);
        await this.updateStatus(jobId, 'downloading', progressPct, `Solicitando download ${i + 1}/${total}: ${proc.numeroProcesso}`, proc.numeroProcesso, total, successCount, failureCount, files, errors);

        try {
          const result = await this.requestDownload(stored, proc);
          if (result.type === 'direct' && result.file) { files.push(result.file); successCount++; }
          else if (result.type === 'queued') { pendingDownloads.push({ proc, requestedAt: Date.now() }); }
          else { failureCount++; errors.push({ processNumber: proc.numeroProcesso, message: result.error || 'Erro ao solicitar download', code: 'REQUEST_FAILED', timestamp: new Date().toISOString() }); }
        } catch (err) {
          failureCount++;
          errors.push({ processNumber: proc.numeroProcesso, message: err instanceof Error ? err.message : 'Erro inesperado', code: 'UNEXPECTED_ERROR', timestamp: new Date().toISOString() });
        }

        if (pendingDownloads.length >= DOWNLOAD_BATCH_SIZE || i === processos.length - 1) {
          if (pendingDownloads.length > 0) {
            const batchResults = await this.collectPendingDownloads(stored, pendingDownloads, jobId);
            for (const br of batchResults) {
              if (br.file) { files.push(br.file); successCount++; }
              else { failureCount++; errors.push({ processNumber: br.processNumber, message: br.error || 'Timeout', code: 'DOWNLOAD_TIMEOUT', timestamp: new Date().toISOString() }); }
            }
            pendingDownloads.length = 0;
          }
        }
        if (i < processos.length - 1) await this.sleep(DOWNLOAD_DELAY);
      }

      // Integrity check & retries
      await this.updateStatus(jobId, 'checking_integrity', 90, 'Verificando integridade...', undefined, total, successCount, failureCount, files, errors);
      const downloadedDigits = new Set(files.map((f) => f.processNumber.replace(/\D/g, '')));
      const missingProcesses = processos.filter((proc) => !downloadedDigits.has(proc.numeroProcesso.replace(/\D/g, '')));

      if (missingProcesses.length > 0 && !this.service.isCancelled(jobId)) {
        for (let retry = 0; retry < 2; retry++) {
          if (missingProcesses.length === 0 || this.service.isCancelled(jobId)) break;
          const retryPending: Array<{ proc: ProcessoInfo; requestedAt: number }> = [];
          for (let i = missingProcesses.length - 1; i >= 0; i--) {
            const proc = missingProcesses[i];
            try {
              const result = await this.requestDownload(stored, proc);
              if (result.type === 'direct' && result.file) { files.push(result.file); successCount++; const errIdx = errors.findIndex((e) => e.processNumber === proc.numeroProcesso); if (errIdx >= 0) { errors.splice(errIdx, 1); failureCount = Math.max(0, failureCount - 1); } missingProcesses.splice(i, 1); }
              else if (result.type === 'queued') retryPending.push({ proc, requestedAt: Date.now() });
            } catch { /* silent */ }
            await this.sleep(DOWNLOAD_DELAY);
          }
          if (retryPending.length > 0) {
            const batchResults = await this.collectPendingDownloads(stored, retryPending, jobId);
            for (const br of batchResults) {
              if (br.file) { files.push(br.file); successCount++; const errIdx = errors.findIndex((e) => e.processNumber === br.processNumber); if (errIdx >= 0) { errors.splice(errIdx, 1); failureCount = Math.max(0, failureCount - 1); } const missIdx = missingProcesses.findIndex((p) => p.numeroProcesso === br.processNumber); if (missIdx >= 0) missingProcesses.splice(missIdx, 1); }
            }
          }
        }
      }

      const finalStatus: PJEJobStatus = this.service.isCancelled(jobId) ? 'cancelled' : failureCount === 0 ? 'completed' : successCount === 0 ? 'failed' : 'partial';
      await this.repository.updateJob({ id: jobId, status: finalStatus, progress: 100, totalProcesses: total, successCount, failureCount, files, errors, completedAt: new Date() });
      await this.updateStatus(jobId, finalStatus, 100, `Concluído: ${successCount}/${total} processos baixados.`, undefined, total, successCount, failureCount, files, errors);
    } catch (err) {
      console.error(`[PJE-WORKER] Erro no job ${shortId}:`, err);
      await this.failJob(jobId, err instanceof Error ? err.message : 'Erro interno do worker');
    } finally {
      this.processingJobs.delete(jobId);
    }
  }

  private async requestDownload(stored: { cookies: Record<string, string>; idUsuarioLocalizacao: string; idUsuario?: number }, proc: { idProcesso: number; numeroProcesso: string; idTaskInstance?: number }): Promise<{ type: 'direct' | 'queued' | 'error'; file?: PJEDownloadedFile; error?: string }> {
    const { idProcesso, numeroProcesso, idTaskInstance } = proc;
    if (!idProcesso) return { type: 'error', error: `idProcesso não disponível para ${numeroProcesso}` };
    try {
      const caRaw = await this.apiGet<string>(stored, `painelUsuario/gerarChaveAcessoProcesso/${idProcesso}`);
      if (!caRaw || typeof caRaw !== 'string' || caRaw.length < 10) return { type: 'error', error: `Chave de acesso inválida para ${numeroProcesso}` };
      const ca = caRaw.replace(/^"|"$/g, '');
      const autosUrl = `${PJE_BASE}/pje/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam?idProcesso=${idProcesso}&ca=${ca}${idTaskInstance ? `&idTaskInstance=${idTaskInstance}` : ''}`;
      const cookieStr = this.serializeCookies(stored.cookies);
      const autosRes = await fetch(autosUrl, { method: 'GET', headers: { Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, redirect: 'follow' });
      const autosHtml = await autosRes.text();
      const viewStateMatch = autosHtml.match(/javax\.faces\.ViewState[^>]+value="([^"]+)"/);
      if (!viewStateMatch?.[1]) return { type: 'error', error: `ViewState não encontrado para ${numeroProcesso}` };
      const downloadBtnId = this.extractDownloadButtonId(autosHtml);
      if (!downloadBtnId) return { type: 'error', error: `Botão de download não encontrado para ${numeroProcesso}` };
      const now = new Date();
      const currentDate = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
      const postBody = new URLSearchParams({ AJAXREQUEST: '_viewRoot', 'navbar:cbTipoDocumento': '0', 'navbar:idDe': '', 'navbar:idAte': '', 'navbar:dtInicioInputDate': '', 'navbar:dtInicioInputCurrentDate': currentDate, 'navbar:dtFimInputDate': '', 'navbar:dtFimInputCurrentDate': currentDate, 'navbar:cbCronologia': 'DESC', '': 'on', navbar: 'navbar', autoScroll: '', 'javax.faces.ViewState': viewStateMatch[1], [downloadBtnId]: downloadBtnId, 'AJAX:EVENTS_COUNT': '1' });
      const downloadRes = await fetch(`${PJE_BASE}/pje/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'X-Requested-With': 'XMLHttpRequest', 'Faces-Request': 'partial/ajax' }, body: postBody.toString(), redirect: 'follow' });
      const responseHtml = await downloadRes.text();
      const s3UrlMatch = responseHtml.match(/window\.open\('(https:\/\/[^']*s3[^']*\.pdf[^']*?)'/);
      if (s3UrlMatch?.[1]) { const file = await this.downloadFromS3(s3UrlMatch[1], numeroProcesso); return { type: 'direct', file }; }
      if (responseHtml.includes('será disponibilizado') || responseHtml.includes('será gerado') || responseHtml.includes('está sendo gerado') || responseHtml.includes('Área de download') || /window\.open\(''\)/.test(responseHtml) || responseHtml.length > 5000) return { type: 'queued' };
      return { type: 'error', error: `Resposta inesperada ao solicitar download de ${numeroProcesso}` };
    } catch (err) { return { type: 'error', error: err instanceof Error ? err.message : 'Erro ao solicitar download' }; }
  }

  private extractDownloadButtonId(html: string): string | null {
    const patterns = [/id="(navbar:j_id\d+)"[^>]*value="Download"/i, /value="Download"[^>]*id="(navbar:j_id\d+)"/i, /(navbar:j_id\d+)[^}]*'parameters'[^}]*\}[^<]*?Download/i, /(navbar:j_id\d+)(?='[^}]*oncomplete[^}]*window\.open)/i];
    for (const p of patterns) { const m = html.match(p); if (m?.[1]) return m[1]; }
    const allButtons = new Map<string, number>(); const btnRegex = /(navbar:j_id(\d+))/g; let btnMatch: RegExpExecArray | null;
    while ((btnMatch = btnRegex.exec(html)) !== null) { if (!allButtons.has(btnMatch[1])) allButtons.set(btnMatch[1], btnMatch.index); }
    if (allButtons.size === 0) return null;
    const candidates = [...allButtons.keys()].filter((id) => { const pos = allButtons.get(id)!; const ctx = html.substring(Math.max(0, pos - 200), Math.min(html.length, pos + 500)); return /download|baixar|gerar/i.test(ctx); });
    if (candidates.length > 0) return candidates[candidates.length - 1];
    const allIds = [...allButtons.keys()]; return allIds[allIds.length - 1];
  }

  private async collectPendingDownloads(stored: any, pendingList: Array<{ proc: { idProcesso: number; numeroProcesso: string }; requestedAt: number }>, jobId: string): Promise<Array<{ processNumber: string; file?: PJEDownloadedFile; error?: string }>> {
    const results: Array<{ processNumber: string; file?: PJEDownloadedFile; error?: string }> = [];
    if (pendingList.length === 0) return results;
    const remaining = new Map<string, any>();
    for (const item of pendingList) remaining.set(item.proc.numeroProcesso.replace(/\D/g, ''), item);
    await this.sleep(DOWNLOAD_POLL_INITIAL);
    const startTime = Date.now(); let pollCount = 0;
    while (remaining.size > 0 && Date.now() - startTime < DOWNLOAD_TIMEOUT) {
      if (this.service.isCancelled(jobId)) break;
      pollCount++;
      try {
        const downloads = await this.fetchAvailableDownloads(stored);
        for (const dl of downloads) {
          const status = (dl.situacaoDownload || '').toUpperCase();
          if (!DOWNLOAD_AVAILABLE_STATUSES.includes(status)) continue;
          let matchedDigits: string | null = null;
          for (const item of dl.itens || []) { const d = (item.numeroProcesso || '').replace(/\D/g, ''); if (remaining.has(d)) { matchedDigits = d; break; } }
          if (!matchedDigits) { const d = (dl.nomeArquivo || '').replace(/\D/g, ''); for (const [digits] of remaining) { if (d.includes(digits)) { matchedDigits = digits; break; } } }
          if (matchedDigits && dl.hashDownload) {
            const item = remaining.get(matchedDigits)!;
            try { const s3Url = await this.generateS3DownloadUrl(stored, dl.hashDownload); if (s3Url) { const file = await this.downloadFromS3(s3Url, item.proc.numeroProcesso); results.push({ processNumber: item.proc.numeroProcesso, file }); remaining.delete(matchedDigits); } } catch { /* silent */ }
          }
        }
      } catch { /* silent */ }
      if (remaining.size > 0) await this.sleep(Math.min(DOWNLOAD_POLL_INTERVAL + pollCount * 2500, 30000));
    }
    for (const [, item] of remaining) results.push({ processNumber: item.proc.numeroProcesso, error: `Timeout (${Math.round(DOWNLOAD_TIMEOUT / 1000)}s)` });
    return results;
  }

  private async fetchAvailableDownloads(stored: any): Promise<any[]> {
    try {
      const cookieStr = this.serializeCookies(stored.cookies);
      const userId = stored.idUsuario || stored.idUsuarioLocalizacao;
      const res = await fetch(`${PJE_REST_BASE}/pjedocs-api/v1/downloadService/recuperarDownloadsDisponiveis?idUsuario=${userId}&sistemaOrigem=PRIMEIRA_INSTANCIA`, { method: 'GET', headers: { ...this.buildHeaders(stored), Cookie: cookieStr } });
      if (res.ok) { const data = (await res.json()) as any; return data?.downloadsDisponiveis || []; }
      return [];
    } catch { return []; }
  }

  private async generateS3DownloadUrl(stored: any, hashDownload: string): Promise<string | null> {
    try {
      const cookieStr = this.serializeCookies(stored.cookies);
      const res = await fetch(`${PJE_REST_BASE}/pjedocs-api/v2/repositorio/gerar-url-download?hashDownload=${encodeURIComponent(hashDownload)}`, { method: 'GET', headers: { ...this.buildHeaders(stored), Cookie: cookieStr } });
      if (res.ok) { const s3Url = await res.text(); return s3Url ? s3Url.replace(/^"|"$/g, '').trim() : null; }
      return null;
    } catch { return null; }
  }

  private async listProcessesByTask(stored: any, taskName: string, isFavorite: boolean, jobId?: string): Promise<Array<{ idProcesso: number; numeroProcesso: string; idTaskInstance?: number }>> {
    try {
      const endpoint = `painelUsuario/recuperarProcessosTarefaPendenteComCriterios/${encodeURIComponent(taskName)}/${isFavorite}`;
      const body = { numeroProcesso: '', classe: null, tags: [], page: 0, maxResults: PAGE_SIZE, competencia: '' };
      const result = await this.apiPost<any>(stored, endpoint, body);
      if (!result || typeof result === 'string') return [];
      const entities = result?.entities || (Array.isArray(result) ? result : []);
      const totalFromApi = result?.count ?? entities.length;
      const seenIds = new Set<number>();
      const processos: Array<{ idProcesso: number; numeroProcesso: string; idTaskInstance?: number }> = [];
      for (const p of entities) { if (p.numeroProcesso && !seenIds.has(p.idProcesso)) { seenIds.add(p.idProcesso); processos.push({ idProcesso: p.idProcesso || 0, numeroProcesso: p.numeroProcesso, idTaskInstance: p.idTaskInstance }); } }
      if (totalFromApi > PAGE_SIZE && entities.length >= PAGE_SIZE) {
        let offset = PAGE_SIZE;
        while (offset < Math.min(totalFromApi, 10000)) {
          if (jobId && this.service.isCancelled(jobId)) break;
          const nextResult = await this.apiPost<any>(stored, endpoint, { ...body, page: offset });
          const ne = nextResult?.entities || (Array.isArray(nextResult) ? nextResult : []);
          if (ne.length === 0) break;
          let novos = 0;
          for (const p of ne) { if (p.numeroProcesso && !seenIds.has(p.idProcesso)) { seenIds.add(p.idProcesso); processos.push({ idProcesso: p.idProcesso || 0, numeroProcesso: p.numeroProcesso, idTaskInstance: p.idTaskInstance }); novos++; } }
          if (novos === 0 || ne.length < PAGE_SIZE) break;
          offset += PAGE_SIZE; await this.sleep(500);
        }
      }
      return processos;
    } catch { return []; }
  }

  private async listProcessesByTag(stored: any, tagId: number): Promise<Array<{ idProcesso: number; numeroProcesso: string }>> {
    try {
      const totalStr = await this.apiGet<string>(stored, `painelUsuario/etiquetas/${tagId}/processos/total`);
      const total = parseInt(String(totalStr), 10) || 0;
      if (total === 0) return [];
      const processos: Array<{ idProcesso: number; numeroProcesso: string }> = [];
      let offset = 0;
      while (offset < total) {
        const result = await this.apiGet<any[]>(stored, `painelUsuario/etiquetas/${tagId}/processos?limit=${PAGE_SIZE}&offset=${offset}`);
        const entities = Array.isArray(result) ? result : [];
        for (const p of entities) { if (p.numeroProcesso) processos.push({ idProcesso: p.idProcesso || 0, numeroProcesso: p.numeroProcesso }); }
        if (entities.length < PAGE_SIZE) break;
        offset += PAGE_SIZE; await this.sleep(500);
      }
      return processos;
    } catch { return []; }
  }

  private async downloadFromS3(url: string, numeroProcesso: string): Promise<PJEDownloadedFile> {
    const fileName = `${numeroProcesso}-processo.pdf`;
    const filePath = path.join(DOWNLOAD_DIR, fileName);
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (!res.ok) throw new Error(`Falha ao baixar de S3: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return { processNumber: numeroProcesso, fileName, filePath, fileSize: buffer.length, downloadedAt: new Date().toISOString() };
  }

  private async updateStatus(jobId: string, status: PJEJobStatus, progress: number, message: string, currentProcess?: string, totalProcesses = 0, successCount = 0, failureCount = 0, files: PJEDownloadedFile[] = [], errors: PJEDownloadErrorType[] = []): Promise<void> {
    this.service.setProgress(jobId, { jobId, status, progress, totalProcesses, successCount, failureCount, currentProcess, files, errors, message, timestamp: Date.now() } as PJEDownloadProgress);
  }

  private async failJob(jobId: string, message: string): Promise<void> {
    console.error(`[PJE-WORKER] Job ${jobId.slice(0, 8)} falhou: ${message}`);
    await this.repository.updateJob({ id: jobId, status: 'failed', completedAt: new Date(), errors: [{ message, code: 'WORKER_ERROR', timestamp: new Date().toISOString() }] });
    await this.updateStatus(jobId, 'failed', 0, message);
  }

  private buildHeaders(stored: any): Record<string, string> {
    return { 'Content-Type': 'application/json', 'X-pje-legacy-app': PJE_LEGACY_APP, Origin: PJE_FRONTEND_ORIGIN, Referer: `${PJE_FRONTEND_ORIGIN}/`, 'X-pje-cookies': this.serializeAllCookies(stored.cookies), 'X-pje-usuario-localizacao': stored.idUsuarioLocalizacao };
  }

  private async apiGet<T>(stored: any, endpoint: string): Promise<T> {
    const cookieStr = this.serializeCookies(stored.cookies);
    const res = await fetch(`${PJE_REST_BASE}/${endpoint}`, { method: 'GET', headers: { ...this.buildHeaders(stored), Cookie: cookieStr } });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  private async apiPost<T>(stored: any, endpoint: string, body: any): Promise<T> {
    const cookieStr = this.serializeCookies(stored.cookies);
    const res = await fetch(`${PJE_REST_BASE}/${endpoint}`, { method: 'POST', headers: { ...this.buildHeaders(stored), Cookie: cookieStr }, body: JSON.stringify(body) });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  }

  private sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
}
