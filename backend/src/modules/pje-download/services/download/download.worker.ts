import { PJEAuthProxy, sessionStore } from '../auth/pje-auth-proxy.service';
import { PJEDownloadService } from '../../pje-download.service';
import type { IDownloadRepository } from '../../repositories/download.repository';
import type { PJEJobStatus, PJEDownloadProgress, PJEDownloadedFile, PJEDownloadError as PJEDownloadErrorType, DownloadJobResponse } from '../../../../shared/types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  serializeCookies, serializeAllCookies, buildPjeHeaders,
  pjeApiGet, pjeApiPost,
  PJE_BASE, PJE_REST_BASE, PJE_FRONTEND_ORIGIN, PJE_LEGACY_APP,
} from '../../../../shared/pje-api-client';
import type { DownloadStrategy, ProcessoInfo } from './strategies/download-strategy';
import { ByTaskStrategy } from './strategies/by-task.strategy';
import { ByTagStrategy } from './strategies/by-tag.strategy';
import { ByNumberStrategy } from './strategies/by-number.strategy';
import { S3Collector } from './collectors/s3-collector';
import { PendingDownloadCollector } from './collectors/pending-collector';

const POLL_INTERVAL = 3000;
const DOWNLOAD_DELAY = 2000;
const DOWNLOAD_BATCH_SIZE = 10;
const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');

const strategies: Record<string, DownloadStrategy> = {
  by_task: new ByTaskStrategy(),
  by_tag: new ByTagStrategy(),
  by_number: new ByNumberStrategy(),
};

const s3Collector = new S3Collector();
const pendingCollector = new PendingDownloadCollector();

export class PJEDownloadWorker {
  private running = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private processingJobs = new Set<string>();

  constructor(
    private service: PJEDownloadService,
    private repository: IDownloadRepository,
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
    } catch { /* silent */ }
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

      if (!cpf || !password) {
        await this.failJob(jobId, 'Credenciais não encontradas no job.');
        return;
      }

      await this.updateStatus(jobId, 'authenticating', 0, 'Autenticando no PJE...');

      const stored = await this.authenticate(shortId, params, cpf, password, jobId);
      if (!stored) return;

      if (this.service.isCancelled(jobId)) return;

      await this.updateStatus(jobId, 'processing', 10, 'Listando processos...');

      // Use Strategy pattern instead of switch/case
      const strategy = strategies[job.mode];
      if (!strategy) {
        await this.failJob(jobId, `Modo de download desconhecido: ${job.mode}`);
        return;
      }

      const processos = await strategy.listProcesses(
        stored,
        params,
        () => this.service.isCancelled(jobId),
      );

      if (this.service.isCancelled(jobId)) return;

      if (processos.length === 0) {
        await this.updateStatus(jobId, 'completed', 100, 'Nenhum processo encontrado.');
        await this.repository.updateJob({ id: jobId, status: 'completed', totalProcesses: 0, successCount: 0, completedAt: new Date() });
        return;
      }

      console.log(`[PJE-WORKER] Job ${shortId} — ${processos.length} processos para baixar`);
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
          if (result.type === 'direct' && result.file) {
            files.push(result.file);
            successCount++;
          } else if (result.type === 'queued') {
            pendingDownloads.push({ proc, requestedAt: Date.now() });
          } else {
            failureCount++;
            errors.push({ processNumber: proc.numeroProcesso, message: result.error || 'Erro ao solicitar download', code: 'REQUEST_FAILED', timestamp: new Date().toISOString() });
          }
        } catch (err) {
          failureCount++;
          errors.push({ processNumber: proc.numeroProcesso, message: err instanceof Error ? err.message : 'Erro inesperado', code: 'UNEXPECTED_ERROR', timestamp: new Date().toISOString() });
        }

        if (pendingDownloads.length >= DOWNLOAD_BATCH_SIZE || i === processos.length - 1) {
          if (pendingDownloads.length > 0) {
            const batchResults = await pendingCollector.collectPendingDownloads(
              stored, pendingDownloads, () => this.service.isCancelled(jobId), DOWNLOAD_DIR,
            );
            for (const br of batchResults) {
              if (br.file) { files.push(br.file); successCount++; }
              else { failureCount++; errors.push({ processNumber: br.processNumber, message: br.error || 'Timeout', code: 'DOWNLOAD_TIMEOUT', timestamp: new Date().toISOString() }); }
            }
            pendingDownloads.length = 0;
          }
        }

        if (i < processos.length - 1) await this.sleep(DOWNLOAD_DELAY);
      }

      // Integrity check and retries
      await this.updateStatus(jobId, 'checking_integrity', 90, 'Verificando integridade dos downloads...', undefined, total, successCount, failureCount, files, errors);

      const downloadedDigits = new Set(files.map((f) => f.processNumber.replace(/\D/g, '')));
      const missingProcesses = processos.filter((proc) => !downloadedDigits.has(proc.numeroProcesso.replace(/\D/g, '')));

      if (missingProcesses.length > 0 && !this.service.isCancelled(jobId)) {
        await this.retryMissing(stored, missingProcesses, jobId, shortId, total, files, errors, successCount, failureCount);
        successCount = files.length;
        failureCount = errors.length;
      }

      const finalStatus: PJEJobStatus = this.service.isCancelled(jobId) ? 'cancelled'
        : failureCount === 0 ? 'completed' : successCount === 0 ? 'failed' : 'partial';

      await this.repository.updateJob({ id: jobId, status: finalStatus, progress: 100, totalProcesses: total, successCount, failureCount, files, errors, completedAt: new Date() });
      await this.updateStatus(jobId, finalStatus, 100, `Concluído: ${successCount}/${total} processos baixados.`, undefined, total, successCount, failureCount, files, errors);

    } catch (err) {
      console.error(`[PJE-WORKER] Erro no job ${shortId}:`, err);
      await this.failJob(jobId, err instanceof Error ? err.message : 'Erro interno do worker');
    } finally {
      this.processingJobs.delete(jobId);
    }
  }

  private async authenticate(shortId: string, params: any, cpf: string, password: string, jobId: string) {
    const proxy = new PJEAuthProxy();
    const existingSessionId = params.pjeSessionId as string | undefined;
    let sessionId: string | undefined;
    let reusedSession = false;

    if (existingSessionId) {
      const existingSession = sessionStore.get(existingSessionId);
      if (existingSession) { sessionId = existingSessionId; reusedSession = true; }
    }

    if (!sessionId) {
      const loginResult = await proxy.login(cpf, password);
      if (this.service.isCancelled(jobId)) return null;
      if (loginResult.needs2FA) { await this.failJob(jobId, '2FA necessário. Faça login primeiro na interface.'); return null; }
      if (loginResult.error || !loginResult.user) { await this.failJob(jobId, loginResult.error || 'Falha na autenticação.'); return null; }
      sessionId = loginResult.sessionId!;

      const profileIndex = params.pjeProfileIndex ?? 0;
      await this.updateStatus(jobId, 'selecting_profile', 5, `Selecionando perfil #${profileIndex}...`);
      const profileResult = await proxy.selectProfile(sessionId, profileIndex);
      if (profileResult.error) { await this.failJob(jobId, `Erro ao selecionar perfil: ${profileResult.error}`); return null; }
      if (this.service.isCancelled(jobId)) return null;
    }

    if (!sessionId) { await this.failJob(jobId, 'Não foi possível obter sessão válida.'); return null; }

    const stored = sessionStore.get(sessionId);
    if (!stored) { await this.failJob(jobId, 'Sessão não encontrada no store.'); return null; }

    if (!stored.idUsuario) {
      try {
        const cookieStr = serializeCookies(stored.cookies, 'pje.tjba.jus.br');
        const allCookieStr = serializeAllCookies(stored.cookies);
        const res = await fetch(`${PJE_REST_BASE}/usuario/currentUser`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'X-pje-legacy-app': PJE_LEGACY_APP, 'Origin': PJE_FRONTEND_ORIGIN, 'Referer': `${PJE_FRONTEND_ORIGIN}/`, 'X-pje-cookies': allCookieStr, 'X-pje-usuario-localizacao': stored.idUsuarioLocalizacao, 'Cookie': cookieStr },
        });
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('json')) {
            const user = await res.json() as any;
            if (user?.idUsuario) stored.idUsuario = user.idUsuario;
          }
        }
      } catch { /* silent */ }
    }

    return stored;
  }

  private async retryMissing(stored: any, missingProcesses: ProcessoInfo[], jobId: string, shortId: string, total: number, files: PJEDownloadedFile[], errors: PJEDownloadErrorType[], successCount: number, failureCount: number) {
    await this.updateStatus(jobId, 'retrying', 92, `Retentando ${missingProcesses.length} processo(s) faltante(s)...`, undefined, total, successCount, failureCount, files, errors);

    for (let retry = 0; retry < 2; retry++) {
      if (missingProcesses.length === 0 || this.service.isCancelled(jobId)) break;

      const retryPending: Array<{ proc: ProcessoInfo; requestedAt: number }> = [];

      for (let i = missingProcesses.length - 1; i >= 0; i--) {
        const proc = missingProcesses[i];
        try {
          const result = await this.requestDownload(stored, proc);
          if (result.type === 'direct' && result.file) {
            files.push(result.file);
            const errIdx = errors.findIndex((e) => e.processNumber === proc.numeroProcesso);
            if (errIdx >= 0) errors.splice(errIdx, 1);
            missingProcesses.splice(i, 1);
          } else if (result.type === 'queued') {
            retryPending.push({ proc, requestedAt: Date.now() });
          }
        } catch { /* silent */ }
        await this.sleep(DOWNLOAD_DELAY);
      }

      if (retryPending.length > 0) {
        const batchResults = await pendingCollector.collectPendingDownloads(stored, retryPending, () => this.service.isCancelled(jobId), DOWNLOAD_DIR);
        for (const br of batchResults) {
          if (br.file) {
            files.push(br.file);
            const errIdx = errors.findIndex((e) => e.processNumber === br.processNumber);
            if (errIdx >= 0) errors.splice(errIdx, 1);
            const missIdx = missingProcesses.findIndex((p) => p.numeroProcesso === br.processNumber);
            if (missIdx >= 0) missingProcesses.splice(missIdx, 1);
          }
        }
      }
    }
  }

  private async requestDownload(stored: any, proc: ProcessoInfo): Promise<{ type: 'direct' | 'queued' | 'error'; file?: PJEDownloadedFile; error?: string }> {
    const { idProcesso, numeroProcesso, idTaskInstance } = proc;
    if (!idProcesso) return { type: 'error', error: `idProcesso não disponível para ${numeroProcesso}` };

    try {
      const caRaw = await pjeApiGet<string>(stored, `painelUsuario/gerarChaveAcessoProcesso/${idProcesso}`);
      if (!caRaw || typeof caRaw !== 'string' || caRaw.length < 10) return { type: 'error', error: `Chave de acesso inválida para ${numeroProcesso}` };
      const ca = caRaw.replace(/^"|"$/g, '');

      const autosUrl = `${PJE_BASE}/pje/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam?idProcesso=${idProcesso}&ca=${ca}${idTaskInstance ? `&idTaskInstance=${idTaskInstance}` : ''}`;
      const cookieStr = serializeCookies(stored.cookies, 'pje.tjba.jus.br');

      const autosRes = await fetch(autosUrl, { method: 'GET', headers: { Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, redirect: 'follow' });
      const autosHtml = await autosRes.text();

      const viewStateMatch = autosHtml.match(/javax\.faces\.ViewState[^>]+value="([^"]+)"/);
      const viewState = viewStateMatch?.[1];
      if (!viewState) return { type: 'error', error: `ViewState não encontrado para ${numeroProcesso}` };

      const downloadBtnId = this.extractDownloadButtonId(autosHtml);
      if (!downloadBtnId) return { type: 'error', error: `Botão de download não encontrado para ${numeroProcesso}` };

      const now = new Date();
      const currentDate = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

      const postBody = new URLSearchParams({
        AJAXREQUEST: '_viewRoot', 'navbar:cbTipoDocumento': '0', 'navbar:idDe': '', 'navbar:idAte': '',
        'navbar:dtInicioInputDate': '', 'navbar:dtInicioInputCurrentDate': currentDate,
        'navbar:dtFimInputDate': '', 'navbar:dtFimInputCurrentDate': currentDate,
        'navbar:cbCronologia': 'DESC', '': 'on', navbar: 'navbar', autoScroll: '',
        'javax.faces.ViewState': viewState, [downloadBtnId]: downloadBtnId, 'AJAX:EVENTS_COUNT': '1',
      });

      const downloadRes = await fetch(`${PJE_BASE}/pje/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: cookieStr, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'X-Requested-With': 'XMLHttpRequest', 'Faces-Request': 'partial/ajax' },
        body: postBody.toString(), redirect: 'follow',
      });

      const responseHtml = await downloadRes.text();

      const s3UrlMatch = responseHtml.match(/window\.open\('(https:\/\/[^']*s3[^']*\.pdf[^']*?)'/);
      if (s3UrlMatch?.[1]) {
        const file = await s3Collector.downloadFromS3(s3UrlMatch[1], numeroProcesso, DOWNLOAD_DIR);
        return { type: 'direct', file };
      }

      if (responseHtml.includes('será disponibilizado') || responseHtml.includes('será gerado') || responseHtml.includes('está sendo gerado') || responseHtml.includes('Área de download') || /window\.open\(''\)/.test(responseHtml) || responseHtml.length > 5000) {
        return { type: 'queued' };
      }

      return { type: 'error', error: `Resposta inesperada ao solicitar download de ${numeroProcesso}` };
    } catch (err) {
      return { type: 'error', error: err instanceof Error ? err.message : 'Erro ao solicitar download' };
    }
  }

  private extractDownloadButtonId(html: string): string | null {
    const patterns = [
      /id="(navbar:j_id\d+)"[^>]*value="Download"/i,
      /value="Download"[^>]*id="(navbar:j_id\d+)"/i,
      /(navbar:j_id\d+)[^}]*'parameters'[^}]*\}[^<]*?Download/i,
      /(navbar:j_id\d+)(?='[^}]*oncomplete[^}]*window\.open)/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return match[1];
    }
    const allButtons = new Map<string, number>();
    const btnRegex = /(navbar:j_id(\d+))/g;
    let btnMatch: RegExpExecArray | null;
    while ((btnMatch = btnRegex.exec(html)) !== null) {
      if (!allButtons.has(btnMatch[1])) allButtons.set(btnMatch[1], btnMatch.index);
    }
    if (allButtons.size === 0) return null;
    const candidates = [...allButtons.keys()].filter((id) => {
      const pos = allButtons.get(id)!;
      const context = html.substring(Math.max(0, pos - 200), Math.min(html.length, pos + 500));
      return /download|baixar|gerar/i.test(context);
    });
    if (candidates.length > 0) return candidates[candidates.length - 1];
    const allIds = [...allButtons.keys()];
    return allIds[allIds.length - 1];
  }

  private async updateStatus(jobId: string, status: PJEJobStatus, progress: number, message: string, currentProcess?: string, totalProcesses = 0, successCount = 0, failureCount = 0, files: PJEDownloadedFile[] = [], errors: PJEDownloadErrorType[] = []): Promise<void> {
    this.service.setProgress(jobId, { jobId, status, progress, totalProcesses, successCount, failureCount, currentProcess, files, errors, message, timestamp: Date.now() } as PJEDownloadProgress);
  }

  private async failJob(jobId: string, message: string): Promise<void> {
    console.error(`[PJE-WORKER] Job ${jobId.slice(0, 8)} falhou: ${message}`);
    await this.repository.updateJob({ id: jobId, status: 'failed', completedAt: new Date(), errors: [{ message, code: 'WORKER_ERROR', timestamp: new Date().toISOString() }] });
    await this.updateStatus(jobId, 'failed', 0, message);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
