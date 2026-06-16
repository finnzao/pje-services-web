import { FileSystemManager, buildFolderName } from './filesystem-manager';
import type { SearchCriteria } from '../componentes/pje-download/types';

export interface DownloadProgress {
  phase: 'initializing' | 'listing' | 'downloading' | 'collecting' | 'finalizing' | 'done' | 'error' | 'cancelled';
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
  try {
    const res = await fetch(directUrl, { mode: 'cors', signal });
    if (res.ok) return await res.blob();
    throw new Error(`HTTP ${res.status}`);
  } catch {
    const base = resolveBaseUrl(apiBase);
    const fullProxyUrl = proxyUrl.startsWith('/') ? `${base}${proxyUrl}` : proxyUrl;
    const res = await fetch(fullProxyUrl, { signal });
    if (!res.ok) throw new Error(`Proxy falhou: HTTP ${res.status}`);
    return await res.blob();
  }
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

  constructor() {
    this.fs = new FileSystemManager();
    this.progress = this.initialProgress();
  }

  get isRunning(): boolean {
    return this.abortController !== null && !this.abortController.signal.aborted;
  }

  async execute(params: DownloadManagerParams, onProgress: ProgressCallback): Promise<void> {
    this.progress = this.initialProgress();
    this.abortController = new AbortController();

    try {
      this.progress.phase = 'initializing';
      this.progress.message = 'Escolha onde salvar os processos...';
      onProgress({ ...this.progress });

      const method = await this.fs.initialize();

      const folderName = buildFolderName({
        mode: params.mode,
        taskName: params.taskName,
        tagName: params.tagName,
      });
      await this.fs.createBatchFolder(folderName);

      this.progress.message = method === 'fsapi'
        ? `Salvando em: ${folderName}/`
        : 'Modo ZIP — arquivo será gerado ao final';
      onProgress({ ...this.progress });

      const base = resolveBaseUrl(params.apiBase);
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

      await this.processSSE(sseUrl.toString(), params.apiBase, onProgress);

      const report = this.buildReport(params, folderName);
      await this.fs.saveReport(report);

      this.progress.phase = 'finalizing';
      this.progress.message = method === 'fsapi'
        ? `${this.progress.successCount} arquivos salvos em ${folderName}/`
        : 'Gerando arquivo ZIP...';
      onProgress({ ...this.progress });

      await this.fs.finalize(folderName);

      this.progress.phase = 'done';
      const summary = this.progress.notAvailableCount > 0
        ? `Concluído: ${this.progress.successCount} arquivo(s) baixado(s), ${this.progress.notAvailableCount} tipo(s) não disponível(eis) (${formatBytes(this.progress.bytesDownloaded)})`
        : `Concluído: ${this.progress.successCount}/${this.progress.totalRequests || this.progress.totalProcesses} (${formatBytes(this.progress.bytesDownloaded)})`;
      this.progress.message = summary;
      onProgress({ ...this.progress });
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        this.progress.phase = 'cancelled';
        this.progress.message = 'Cancelado pelo usuário';
      } else {
        this.progress.phase = 'error';
        this.progress.message = err instanceof Error ? err.message : 'Erro desconhecido';
      }
      onProgress({ ...this.progress });
    } finally {
      this.abortController = null;
    }
  }

  cancel(): void {
    this.abortController?.abort();
  }

  dispose(): void {
    this.cancel();
    this.fs.dispose();
  }

  private processSSE(url: string, apiBase: string, onProgress: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const es = new EventSource(url);
      const signal = this.abortController!.signal;

      const sem = new Semaphore(MAX_CONCURRENT_FILE_DOWNLOADS);
      const pendingDownloads: Promise<void>[] = [];

      signal.addEventListener('abort', () => {
        es.close();
        Promise.allSettled(pendingDownloads).then(() => resolve());
      });

      es.addEventListener('listing', (e: any) => {
        const data = JSON.parse(e.data);
        this.progress.phase = 'downloading';
        this.progress.totalProcesses = data.total;
        this.progress.totalRequests = data.totalRequests || data.total;
        this.progress.documentTypes = data.documentTypes || [];
        const tiposLabel = this.progress.documentTypes.length > 0
          ? ` × ${this.progress.documentTypes.length} tipo(s)`
          : '';
        this.progress.message = `${data.total} processo(s) encontrado(s)${tiposLabel}`;
        onProgress({ ...this.progress });
      });

      es.addEventListener('progress', (e: any) => {
        const data = JSON.parse(e.data);
        this.progress.currentIndex = data.index;
        this.progress.currentProcess = data.processNumber;
        this.progress.currentDocumentType = data.documentType ?? undefined;
        const tipo = data.documentType ? ` [${data.documentType}]` : '';
        this.progress.message = `${data.index}/${data.total}: ${data.processNumber}${tipo}`;
        onProgress({ ...this.progress });
      });

      es.addEventListener('url', (e: any) => {
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

      es.addEventListener('queued', (e: any) => {
        const data = JSON.parse(e.data);
        this.progress.queuedCount++;
        const tipo = data.documentType ? ` [${data.documentType}]` : '';
        this.progress.message = `${data.processNumber}${tipo}: aguardando PJE gerar PDF...`;
        onProgress({ ...this.progress });
      });

      es.addEventListener('not_available', (e: any) => {
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

      es.addEventListener('error', (e: any) => {
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
        } catch {
          es.close();
          Promise.allSettled(pendingDownloads).then(() => {
            reject(new Error('Conexão com servidor perdida'));
          });
        }
      });

      es.addEventListener('done', (e: any) => {
        const data = JSON.parse(e.data);
        this.progress.phase = 'collecting';
        const notAvLabel = data.notAvailable > 0 ? `, ${data.notAvailable} não disp.` : '';
        this.progress.message = `Servidor concluiu: ${data.success} ok, ${data.failed} erros${notAvLabel}. Aguardando downloads finalizarem...`;
        onProgress({ ...this.progress });
        es.close();

        Promise.allSettled(pendingDownloads).then(() => {
          this.progress.message = `Downloads finalizados: ${this.progress.successCount} ok, ${this.progress.failedCount} erros`;
          onProgress({ ...this.progress });
          resolve();
        });
      });

      es.addEventListener('fatal', (e: any) => {
        const data = JSON.parse(e.data);
        es.close();
        Promise.allSettled(pendingDownloads).then(() => {
          reject(new Error(data.message));
        });
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          Promise.allSettled(pendingDownloads).then(() => {
            reject(new Error('Falha na conexão SSE'));
          });
        }
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
        lines.push(`  ✗ ${f.name}: ${f.error}`);
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
        lines.push(`  ✓ ${f.name} (${formatBytes(f.size)})`);
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
