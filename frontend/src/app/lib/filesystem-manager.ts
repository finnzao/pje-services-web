/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SaveResult {
  fileName: string;
  size: number;
  savedAt: string;
  method: StorageMethod;
}

export type StorageMethod = 'fsapi' | 'zip';

const MAX_FILENAME_LENGTH = 200;
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

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
  mode: 'by_task' | 'by_tag' | 'by_number';
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
  };

  return `PJE_${labels[params.mode]}_${date}_${time}`;
}

export class FileSystemManager {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private batchDirHandle: FileSystemDirectoryHandle | null = null;
  private memoryFiles = new Map<string, Blob>();
  private _method: StorageMethod = 'zip';

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  get method(): StorageMethod {
    return this._method;
  }

  get fileCount(): number {
    return this.memoryFiles.size;
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

    const zipBlob = await this.buildZip();
    this.triggerDownload(zipBlob, `${zipFileName}.zip`);
    this.memoryFiles.clear();
  }

  dispose(): void {
    this.memoryFiles.clear();
    this.dirHandle = null;
    this.batchDirHandle = null;
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
    return { fileName: name, size: blob.size, savedAt: new Date().toISOString(), method: 'zip' };
  }

  private async buildZip(): Promise<Blob> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    for (const [name, blob] of this.memoryFiles) {
      zip.file(name, blob);
    }

    return zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
  }

  private triggerDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
}