/* eslint-disable @typescript-eslint/no-explicit-any */
import { createZipChunks, zipToBlob, type ZipInput } from './zip-stream';
import { isServiceWorkerDownloadSupported, saveZipViaServiceWorker } from './zip-download-sw';

export interface SaveResult {
  fileName: string;
  size: number;
  savedAt: string;
  method: StorageMethod;
}

export type StorageMethod = 'fsapi' | 'zip';

const MAX_FILENAME_LENGTH = 200;
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

const SAFE_BLOB_LIMIT = 1024 * 1024 * 1024;
const ZIP_SW_URL = process.env.NEXT_PUBLIC_ZIP_SW_URL || '/zip-sw.js';

function sanitizeFileName(name: string): string {
  return name
    .replace(INVALID_FILENAME_CHARS, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, MAX_FILENAME_LENGTH);
}

function sanitizeFolderToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .trim()
    .slice(0, 50);
}

export function buildFolderName(params: {
  mode: 'by_task' | 'by_tag' | 'by_number' | 'by_search';
  taskName?: string;
  tagName?: string;
}): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5).replace(':', 'h');

  const labels: Record<string, string> = {
    by_task: sanitizeFolderToken(params.taskName || 'Tarefa'),
    by_tag: sanitizeFolderToken(params.tagName || 'Etiqueta'),
    by_number: 'Processos_Manual',
    by_search: 'Pesquisa_Geral',
  };

  return `PJE_${labels[params.mode]}_${date}_${time}`;
}

export class FileSystemManager {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private batchDirHandle: FileSystemDirectoryHandle | null = null;
  private memoryFiles = new Map<string, Blob>();
  private totalBytes = 0;
  private _method: StorageMethod = 'zip';
  private lastZip: { blob: Blob; fileName: string } | null = null;

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  static canSaveSingleFile(): boolean {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
  }

  get method(): StorageMethod {
    return this._method;
  }

  get fileCount(): number {
    return this.memoryFiles.size;
  }

  get canRedownloadZip(): boolean {
    return this.lastZip !== null || (this._method === 'fsapi' && this.batchDirHandle !== null);
  }

  async redownloadZip(): Promise<boolean> {
    if (this.lastZip) {
      this.triggerAnchorDownload(this.lastZip.blob, this.lastZip.fileName);
      return true;
    }
    if (this._method === 'fsapi' && this.batchDirHandle) {
      const entries = await this.collectFsEntries();
      if (entries.length === 0) return false;
      const fileName = `${(this.batchDirHandle as any).name || 'PJE_processos'}.zip`;
      await this.downloadZipFromEntries(entries, fileName);
      return true;
    }
    return false;
  }

  private async collectFsEntries(): Promise<ZipInput[]> {
    const entries: ZipInput[] = [];
    const dir = this.batchDirHandle as any;
    if (!dir?.entries) return entries;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        entries.push({ name, blob: file });
      }
    }
    return entries;
  }

  private async downloadZipFromEntries(entries: ZipInput[], fileName: string): Promise<void> {
    const total = entries.reduce((s, e) => s + e.blob.size, 0);
    if (total <= SAFE_BLOB_LIMIT) {
      const blob = await zipToBlob(entries);
      this.triggerAnchorDownload(blob, fileName);
      return;
    }
    if (FileSystemManager.canSaveSingleFile()) {
      await this.streamToFsApi(entries, fileName);
      return;
    }
    if (isServiceWorkerDownloadSupported()) {
      await saveZipViaServiceWorker(entries, fileName, ZIP_SW_URL);
      return;
    }
    const blob = await zipToBlob(entries);
    this.triggerAnchorDownload(blob, fileName);
  }

  async initialize(options?: { skipPicker?: boolean }): Promise<StorageMethod> {
    if (!FileSystemManager.isSupported() || options?.skipPicker) {
      this._method = 'zip';
      return this._method;
    }

    try {
      this.dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
      });
      this._method = 'fsapi';
    } catch {
      this._method = 'zip';
    }

    return this._method;
  }

  async createBatchFolder(folderName: string): Promise<void> {
    if (this._method !== 'fsapi' || !this.dirHandle) return;
    this.batchDirHandle = await this.dirHandle.getDirectoryHandle(folderName, { create: true });
  }

  async saveFile(fileName: string, blob: Blob): Promise<SaveResult> {
    const safeName = sanitizeFileName(fileName);

    if (this._method === 'fsapi' && this.batchDirHandle) {
      return this.writeToFs(safeName, blob);
    }

    return this.storeInMemory(safeName, blob);
  }

  async saveReport(content: string): Promise<void> {
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    await this.saveFile('_relatorio.txt', blob);
  }

  async finalize(zipFileName: string): Promise<void> {
    if (this._method === 'fsapi') return;
    if (this.memoryFiles.size === 0) return;

    const fileName = `${zipFileName}.zip`;
    const entries = this.buildEntries();

    if (this.totalBytes <= SAFE_BLOB_LIMIT) {
      const blob = await zipToBlob(entries);
      this.lastZip = { blob, fileName };
      this.triggerAnchorDownload(blob, fileName);
      this.reset();
      return;
    }

    if (FileSystemManager.canSaveSingleFile()) {
      await this.streamToFsApi(entries, fileName);
      this.reset();
      return;
    }

    if (isServiceWorkerDownloadSupported()) {
      try {
        await saveZipViaServiceWorker(entries, fileName, ZIP_SW_URL);
        this.reset();
        return;
      } catch (err) {
        this.reset();
        throw err instanceof Error ? err : new Error('Falha no download via service worker.');
      }
    }

    try {
      const blob = await zipToBlob(entries);
      this.lastZip = { blob, fileName };
      this.triggerAnchorDownload(blob, fileName);
      this.reset();
    } catch {
      this.reset();
      throw new Error(
        'Download grande demais para este navegador montar em memória. Use o Chrome/Edge.',
      );
    }
  }

  dispose(): void {
    this.reset();
    this.lastZip = null;
    this.dirHandle = null;
    this.batchDirHandle = null;
  }

  private reset(): void {
    this.memoryFiles.clear();
    this.totalBytes = 0;
  }

  private buildEntries(): ZipInput[] {
    const entries: ZipInput[] = [];
    for (const [name, blob] of this.memoryFiles) entries.push({ name, blob });
    return entries;
  }

  private async streamToFsApi(entries: ZipInput[], fileName: string): Promise<void> {
    let handle: FileSystemFileHandle;
    try {
      handle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Arquivo ZIP', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (err) {
      if ((err as any)?.name === 'AbortError') {
        throw new Error('Salvamento cancelado: escolha um destino para o arquivo ZIP.');
      }
      throw err;
    }
    const writable = await handle.createWritable();
    try {
      for await (const chunk of createZipChunks(entries)) {
        await writable.write(chunk as BufferSource);
      }
    } finally {
      await writable.close();
    }
  }

  private async writeToFs(name: string, blob: Blob): Promise<SaveResult> {
    const fileHandle = await this.batchDirHandle!.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return { fileName: name, size: blob.size, savedAt: new Date().toISOString(), method: 'fsapi' };
  }

  private storeInMemory(name: string, blob: Blob): SaveResult {
    this.memoryFiles.set(name, blob);
    this.totalBytes += blob.size;
    return { fileName: name, size: blob.size, savedAt: new Date().toISOString(), method: 'zip' };
  }

  private triggerAnchorDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
