import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PJEDownloadedFile } from '../../../../../shared/types';
import { serializePjeCookies, buildPjeHeaders, PJE_REST_BASE } from '../../../../../shared/pje-api-client';

interface StoredSession { cookies: Record<string, string>; idUsuarioLocalizacao: string; idUsuario?: number; }

export class S3Collector {
  async downloadFromS3(url: string, numeroProcesso: string, downloadDir: string): Promise<PJEDownloadedFile> {
    const fileName = `${numeroProcesso}-processo.pdf`;
    const filePath = path.join(downloadDir, fileName);
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (!res.ok) throw new Error(`S3: HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return { processNumber: numeroProcesso, fileName, filePath, fileSize: buffer.length, downloadedAt: new Date().toISOString() };
  }

  async generateS3DownloadUrl(stored: StoredSession, hashDownload: string): Promise<string | null> {
    const cookieStr = serializePjeCookies(stored.cookies);
    const headers = { ...buildPjeHeaders(stored as any), Cookie: cookieStr };
    const url = `${PJE_REST_BASE}/pjedocs-api/v2/repositorio/gerar-url-download?hashDownload=${encodeURIComponent(hashDownload)}`;
    try { const res = await fetch(url, { method: 'GET', headers }); if (res.ok) { const s3Url = await res.text(); return s3Url ? s3Url.replace(/^"|"$/g, '').trim() : null; } } catch {}
    return null;
  }
}
