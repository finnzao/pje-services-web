import { FileSystemManager, buildFolderName } from './filesystem-manager';
import type { SearchCriteria } from '../componentes/pje-download/types';

export interface DownloadProgress {
  phase: 'initializing' | 'listing' | 'downloading' | 'collecting' | 'finalizing' | 'cancelling' | 'done' | 'error' | 'cancelled';
  totalProcesses: number;
  totalRequests: number;
  currentIndex: number;
  currentProcess: string;
  currentDocumentType?: string;
  successCount: number;
  failedCount: number;
  queuedCount: number;
  notAvailableCount: number;
  bytesDownloaded: number;
  message: string;
  files: Array<{
    name: string;
    size: number;
    status: 'ok' | 'downloading' | 'error' | 'not_available';
    error?: string;
    documentType?: string;
  }>;
  documentTypes: string[];
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export interface DownloadManagerParams {
  apiBase: string;
  sessionId: string;
  mode: 'by_task' | 'by_tag' | 'by_number' | 'by_search';
  taskName?: string;
  tagName?: string;
  tagId?: number;
  isFavorite?: boolean;
  processNumbers?: string[];
  documentTypes?: string[];
  searchCriteria?: SearchCriteria;
}

const MAX_CONCURRENT_FILE_DOWNLOADS = 3;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function resolveBaseUrl(apiBase: string): string {
  if (apiBase) return apiBase;
  const envBase = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_URL : undefined;
  if (envBase) return envBase;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

function stripKnownExt(name: string): string {
  return name.replace(/\.(pdf|zip)$/i, '');
}

async function sniffBlobKind(blob: Blob): Promise<'pdf' | 'zip' | 'other'> {
  try {
    const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
      return 'pdf';
    }
    if (
      header[0] === 0x50 && header[1] === 0x4b &&
      (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07)
    ) {
      return 'zip';
    }
  } catch {
  }
  return 'other';
}

async function expandDownloadedBlob(
  fileName: string,
  blob: Blob,
): Promise<Array<{ name: string; blob: Blob }>> {
  const kind = await sniffBlobKind(blob);
  const base = stripKnownExt(fileName);

  if (kind === 'zip') {
    return [{ name: `${base}.zip`, blob }];
  }

  const name = kind === 'pdf' ? `${base}.pdf` : fileName;
  return [{ name, blob }];
}

async function downloadWithFallback(
  directUrl: string,
  proxyUrl: string,
  apiBase: string,
  signal?: AbortSignal,
): Promise<Blob> {
  if (proxyUrl) {
    const base = resolveBaseUrl(apiBase);
    const fullProxyUrl = proxyUrl.startsWith('/') ? `${base}${proxyUrl}` : proxyUrl;
    try {
      const res = await fetch(fullProxyUrl, { signal });
      if (res.ok) return await res.blob();
      throw new Error(`Proxy HTTP ${res.status}`);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }

  const res = await fetch(directUrl, { mode: 'cors', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.blob();
}

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}

export class DownloadManager {
  private fs: FileSystemManager;
  private abortController: AbortController | null = null;
  private progress: DownloadProgress;
  private streamId: string | null = null;
  private apiBaseResolved = '';
  private onProgressRef: ProgressCallback | null = null;
  private cancelRequested = false;
  private serverCancelled = false;

  constructor() {
    this.fs = new FileSystemManager();
    this.progress = this.initialProgress();
  }

  get isRunning(): boolean {
    return this.abortController !== null && !this.abortController.signal.aborted;
  }

  get storageMethod(): 'fsapi' | 'zip' {
    return this.fs.method;
  }

  get canRedownloadZip(): boolean {
    return this.fs.canRedownloadZip;
  }

  async redownloadZip(): Promise<boolean> {
    return this.fs.redownloadZip();
  }

  async execute(params: DownloadManagerParams, onProgress: ProgressCallback): Promise<void> {
    this.progress = this.initialProgress();
    this.abortController = new AbortController();
    this.streamId = null;
    this.cancelRequested = false;
    this.serverCancelled = false;
    this.onProgressRef = onProgress;
    this.apiBaseResolved = resolveBaseUrl(params.apiBase);

    let folderName = '';
    let method: 'fsapi' | 'zip' = 'zip';
    let sseError: Error | null = null;

    try {
      this.progress.phase = 'initializing';
      this.progress.message = 'Escolha onde salvar os processos...';
      onProgress({ ...this.progress });

      method = await this.fs.initialize();

      folderName = buildFolderName({
        mode: params.mode,
        taskName: params.taskName,
        tagName: params.tagName,
      });
      await this.fs.createBatchFolder(folderName);

      this.progress.message = method === 'fsapi'
        ? `Salvando em: ${folderName}/`
        : 'Modo ZIP — arquivo será gerado ao final';
      onProgress({ ...this.progress });

      const base = this.apiBaseResolved;
      const sseUrl = new URL(`${base}/api/pje/downloads/stream-batch`);
      sseUrl.searchParams.set('sessionId', params.sessionId);
      sseUrl.searchParams.set('mode', params.mode);
      if (params.taskName) sseUrl.searchParams.set('taskName', params.taskName);
      if (params.tagId) sseUrl.searchParams.set('tagId', String(params.tagId));
      if (params.isFavorite) sseUrl.searchParams.set('isFavorite', 'true');
      if (params.processNumbers?.length) {
        sseUrl.searchParams.set('processNumbers', params.processNumbers.join(','));
      }
      if (params.documentTypes && params.documentTypes.length > 0) {
        sseUrl.searchParams.set('documentTypes', params.documentTypes.join(','));
      }
      if (params.searchCriteria) {
        sseUrl.searchParams.set('criteria', JSON.stringify(params.searchCriteria));
      }

      try {
        await this.processSSE(sseUrl.toString(), params.apiBase, onProgress);
      } catch (err) {
        if (!this.abortController?.signal.aborted && !this.cancelRequested) {
          sseError = err instanceof Error ? err : new Error('Falha na conexão com o servidor.');
        }
      }
    } catch (err) {
      this.abortController = null;
      this.streamId = null;
      if (this.cancelRequested || this.abortController === null) {
        this.progress.phase = 'cancelled';
        this.progress.message = 'Cancelado pelo usuário';
      } else {
        this.progress.phase = 'error';
        this.progress.message = err instanceof Error ? err.message : 'Erro desconhecido';
      }
      onProgress({ ...this.progress });
      return;
    }

    try {
      const report = this.buildReport(params, folderName);
      await this.fs.saveReport(report);

      this.progress.phase = 'finalizing';
      this.progress.message = method === 'fsapi'
        ? `${this.progress.successCount} arquivos salvos em ${folderName}/`
        : 'Gerando arquivo ZIP...';
      onProgress({ ...this.progress });

      await this.fs.finalize(folderName);
    } catch (err) {
      this.abortController = null;
      this.streamId = null;
      this.progress.phase = 'error';
      this.progress.message = err instanceof Error ? err.message : 'Falha ao gerar o arquivo final.';
      onProgress({ ...this.progress });
      return;
    }

    this.abortController = null;
    this.streamId = null;

    if (this.serverCancelled) {
      this.progress.phase = 'cancelled';
      this.progress.message = `Cancelado pelo usuário. ${this.progress.successCount} arquivo(s) salvo(s) antes da interrupção (${formatBytes(this.progress.bytesDownloaded)}).`;
      onProgress({ ...this.progress });
      return;
    }

    if (sseError && this.progress.successCount === 0) {
      this.progress.phase = 'error';
      this.progress.message = sseError.message;
      onProgress({ ...this.progress });
      return;
    }

    this.progress.phase = 'done';
    const summary = this.progress.notAvailableCount > 0
      ? `${this.progress.successCount} arquivo(s) baixado(s), ${this.progress.notAvailableCount} tipo(s) não disponível(eis) (${formatBytes(this.progress.bytesDownloaded)})`
      : `${this.progress.successCount}/${this.progress.totalRequests || this.progress.totalProcesses} (${formatBytes(this.progress.bytesDownloaded)})`;
    this.progress.message = sseError
      ? `Conexão interrompida, mas o ZIP foi gerado com ${this.progress.successCount} arquivo(s) já baixado(s). ${summary}`
      : `Concluído: ${summary}`;
    onProgress({ ...this.progress });
  }

  async cancel(): Promise<void> {
    if (this.cancelRequested) return;
    this.cancelRequested = true;
    this.progress.phase = 'cancelling';
    this.progress.message = 'Cancelando — aguardando o servidor interromper o processamento...';
    this.onProgressRef?.({ ...this.progress });

    if (this.streamId) {
      try {
        await fetch(`${this.apiBaseResolved}/api/pje/downloads/stream-batch/${this.streamId}/cancel`, {
          method: 'POST',
          keepalive: true,
        });
      } catch {  }
    }
  }

  dispose(): void {
    this.cancelRequested = true;
    this.abortController?.abort();
    this.fs.dispose();
  }

  private processSSE(url: string, apiBase: string, onProgress: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const es = new EventSource(url);
      const signal = this.abortController!.signal;

      const sem = new Semaphore(MAX_CONCURRENT_FILE_DOWNLOADS);
      const pendingDownloads: Promise<void>[] = [];
      let settled = false;

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        es.close();
        Promise.allSettled(pendingDownloads).then(() => resolve());
      };
      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        es.close();
        Promise.allSettled(pendingDownloads).then(() => reject(err));
      };

      signal.addEventListener('abort', () => { settleResolve(); });

      es.addEventListener('init', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data?.streamId) this.streamId = data.streamId;
        } catch {  }
      });

      es.addEventListener('precheck', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.ready > 0 && this.progress.phase !== 'cancelling') {
            this.progress.message = `${data.ready} de ${data.total} processo(s) ja prontos no PJE — reutilizando sem nova solicitacao`;
            onProgress({ ...this.progress });
          }
        } catch {  }
      });

      es.addEventListener('listing', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        if (this.progress.phase !== 'cancelling') this.progress.phase = 'downloading';
        this.progress.totalProcesses = data.total;
        this.progress.totalRequests = data.totalRequests || data.total;
        this.progress.documentTypes = data.documentTypes || [];
        const tiposLabel = this.progress.documentTypes.length > 0
          ? ` × ${this.progress.documentTypes.length} tipo(s)`
          : '';
        this.progress.message = `${data.total} processo(s) encontrado(s)${tiposLabel}`;
        onProgress({ ...this.progress });
      });

      es.addEventListener('progress', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        this.progress.currentIndex = data.index;
        this.progress.currentProcess = data.processNumber;
        this.progress.currentDocumentType = data.documentType ?? undefined;
        if (this.progress.phase !== 'cancelling') {
          const tipo = data.documentType ? ` [${data.documentType}]` : '';
          this.progress.message = `${data.index}/${data.total}: ${data.processNumber}${tipo}`;
        }
        onProgress({ ...this.progress });
      });

      es.addEventListener('url', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        const fileName = data.fileName || `${data.processNumber}.pdf`;
        const documentType = data.documentType ?? undefined;

        this.progress.files.push({
          name: fileName, size: 0, status: 'downloading', documentType,
        });
        onProgress({ ...this.progress });

        const downloadPromise = (async () => {
          await sem.acquire();
          try {
            const blob = await downloadWithFallback(
              data.downloadUrl,
              data.proxyUrl || '',
              apiBase,
              signal,
            );

            const saved = await expandDownloadedBlob(fileName, blob);

            let totalSize = 0;
            for (const file of saved) {
              await this.fs.saveFile(file.name, file.blob);
              totalSize += file.blob.size;
            }

            const fileEntry = this.progress.files.find(
              (f) => f.name === fileName && f.status === 'downloading',
            );
            const first = saved[0];
            if (fileEntry) {
              fileEntry.name = first.name;
              fileEntry.size = first.blob.size;
              fileEntry.status = 'ok';
            }
            for (let i = 1; i < saved.length; i++) {
              this.progress.files.push({
                name: saved[i].name,
                size: saved[i].blob.size,
                status: 'ok',
                documentType,
              });
            }

            this.progress.successCount++;
            this.progress.bytesDownloaded += totalSize;
          } catch (err) {
            const fileEntry = this.progress.files.find(
              (f) => f.name === fileName && f.status === 'downloading',
            );
            if (fileEntry) {
              fileEntry.status = 'error';
              fileEntry.error = err instanceof Error ? err.message : 'Erro';
            }
            this.progress.failedCount++;
          } finally {
            sem.release();
          }
          onProgress({ ...this.progress });
        })();

        pendingDownloads.push(downloadPromise);
      });

      es.addEventListener('queued', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        this.progress.queuedCount++;
        if (this.progress.phase !== 'cancelling') {
          const tipo = data.documentType ? ` [${data.documentType}]` : '';
          this.progress.message = `${data.processNumber}${tipo}: aguardando PJE gerar PDF...`;
        }
        onProgress({ ...this.progress });
      });

      es.addEventListener('not_available', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        const documentType = data.documentType ?? undefined;
        const suffix = documentType ? `_${documentType.replace(/\s+/g, '_')}` : '';
        const fileName = `${data.processNumber}${suffix}.pdf`;
        this.progress.notAvailableCount++;
        this.progress.files.push({
          name: fileName, size: 0, status: 'not_available',
          documentType, error: data.message,
        });
        onProgress({ ...this.progress });
      });

      es.addEventListener('item_error', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          this.progress.failedCount++;
          const documentType = data.documentType ?? undefined;
          const suffix = documentType ? `_${documentType.replace(/\s+/g, '_')}` : '';
          this.progress.files.push({
            name: `${data.processNumber}${suffix}.pdf`,
            size: 0, status: 'error', documentType, error: data.message,
          });
          onProgress({ ...this.progress });
        } catch {  }
      });

      es.addEventListener('cancelled', () => {
        this.serverCancelled = true;
        this.progress.phase = 'cancelling';
        this.progress.message = 'Cancelamento confirmado pelo servidor. Finalizando...';
        onProgress({ ...this.progress });
      });

      es.addEventListener('done', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        if (data?.cancelled) this.serverCancelled = true;
        this.progress.phase = this.serverCancelled ? 'cancelling' : 'collecting';
        const notAvLabel = data.notAvailable > 0 ? `, ${data.notAvailable} não disp.` : '';
        this.progress.message = this.serverCancelled
          ? 'Servidor interrompeu o processamento. Finalizando downloads em andamento...'
          : `Servidor concluiu: ${data.success} ok, ${data.failed} erros${notAvLabel}. Aguardando downloads finalizarem...`;
        onProgress({ ...this.progress });

        if (settled) return;
        settled = true;
        es.close();
        Promise.allSettled(pendingDownloads).then(() => {
          this.progress.message = this.serverCancelled
            ? `Downloads interrompidos: ${this.progress.successCount} ok, ${this.progress.failedCount} erros`
            : `Downloads finalizados: ${this.progress.successCount} ok, ${this.progress.failedCount} erros`;
          onProgress({ ...this.progress });
          resolve();
        });
      });

      es.addEventListener('fatal', (e: MessageEvent) => {
        let message = 'Erro fatal no servidor';
        try { message = JSON.parse(e.data).message || message; } catch {  }
        settleReject(new Error(message));
      });

      es.onerror = () => {
        if (settled) return;
        es.close();
        if (this.cancelRequested) { settleResolve(); return; }
        settleReject(new Error('Falha na conexão com o servidor (SSE).'));
      };
    });
  }

  private buildReport(params: DownloadManagerParams, folderName: string): string {
    const lines: string[] = [
      `═══════════════════════════════════════════════════`,
      `  RELATÓRIO DE DOWNLOAD — PJE/TJBA`,
      `═══════════════════════════════════════════════════`,
      ``,
      `Data: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      `Pasta: ${folderName}`,
      `Modo: ${
        params.mode === 'by_task' ? 'Por Tarefa'
        : params.mode === 'by_tag' ? 'Por Etiqueta'
        : params.mode === 'by_search' ? 'Por Pesquisa Geral'
        : 'Por Número (lista CNJ)'
      }`,
    ];

    if (this.serverCancelled) lines.push(`Status: CANCELADO PELO USUÁRIO`);
    if (params.taskName) lines.push(`Tarefa: ${params.taskName}`);
    if (params.tagName) lines.push(`Etiqueta: ${params.tagName}`);
    if (params.processNumbers?.length) {
      lines.push(`Lista de processos: ${params.processNumbers.length} número(s)`);
    }
    if (params.searchCriteria) {
      const preenchidos = Object.entries(params.searchCriteria)
        .filter(([, v]) => (v || '').toString().trim())
        .map(([k, v]) => `${k}=${v}`);
      lines.push(`Critérios: ${preenchidos.join('; ') || '(nenhum)'}`);
    }
    if (params.documentTypes?.length) {
      lines.push(`Tipos de documento: ${params.documentTypes.join(', ')}`);
    } else {
      lines.push(`Tipos de documento: TODOS (sem filtro)`);
    }

    lines.push(
      ``,
      `RESULTADO:`,
      `  Total de processos:    ${this.progress.totalProcesses}`,
      `  Total de requisições:  ${this.progress.totalRequests}`,
      `  Downloads OK:          ${this.progress.successCount}`,
      `  Falhas:                ${this.progress.failedCount}`,
      `  Tipos não disponíveis: ${this.progress.notAvailableCount}`,
      `  Bytes baixados:        ${formatBytes(this.progress.bytesDownloaded)}`,
      ``,
    );

    const errors = this.progress.files.filter(f => f.status === 'error');
    if (errors.length > 0) {
      lines.push(`ERROS (${errors.length}):`);
      for (const f of errors) {
        lines.push(`  x ${f.name}: ${f.error}`);
      }
      lines.push('');
    }

    const notAvail = this.progress.files.filter(f => f.status === 'not_available');
    if (notAvail.length > 0) {
      lines.push(`TIPOS NÃO DISPONÍVEIS (${notAvail.length}):`);
      for (const f of notAvail) {
        lines.push(`  - ${f.name}: ${f.error}`);
      }
      lines.push('');
    }

    const ok = this.progress.files.filter(f => f.status === 'ok');
    if (ok.length > 0) {
      lines.push(`ARQUIVOS BAIXADOS (${ok.length}):`);
      for (const f of ok) {
        lines.push(`  ok ${f.name} (${formatBytes(f.size)})`);
      }
    }

    lines.push(``, `═══════════════════════════════════════════════════`);
    return lines.join('\n');
  }

  private initialProgress(): DownloadProgress {
    return {
      phase: 'initializing',
      totalProcesses: 0,
      totalRequests: 0,
      currentIndex: 0,
      currentProcess: '',
      successCount: 0,
      failedCount: 0,
      queuedCount: 0,
      notAvailableCount: 0,
      bytesDownloaded: 0,
      message: '',
      files: [],
      documentTypes: [],
    };
  }
}
