import type { PJEDownloadedFile } from '../../../../../shared/types';
import { serializePjeCookies, buildPjeHeaders, PJE_REST_BASE } from '../../../../../shared/pje-api-client';
import { S3Collector } from './s3-collector';

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

interface StoredSession { cookies: Record<string, string>; idUsuarioLocalizacao: string; idUsuario?: number; }
interface PendingItem { proc: { idProcesso: number; numeroProcesso: string }; requestedAt: number; }
interface CollectResult { processNumber: string; file?: PJEDownloadedFile; error?: string; }

export class PendingDownloadCollector {
  private s3Collector = new S3Collector();
  async collectPendingDownloads(stored: StoredSession, pendingList: PendingItem[], isCancelled: () => boolean, downloadDir: string): Promise<CollectResult[]> {
    const results: CollectResult[] = [];
    if (pendingList.length === 0) return results;
    const remaining = new Map<string, PendingItem>();
    for (const item of pendingList) remaining.set(item.proc.numeroProcesso.replace(/\D/g, ''), item);
    await sleep(5000);
    const startTime = Date.now(); let pollCount = 0;
    while (remaining.size > 0 && Date.now() - startTime < 600000) {
      if (isCancelled()) break; pollCount++;
      try {
        const downloads = await this.fetchAvailableDownloads(stored);
        for (const dl of downloads) {
          const status = (dl.situacaoDownload || '').toUpperCase();
          if (!['S', 'DISPONIVEL', 'AVAILABLE'].includes(status)) continue;
          let matchedDigits: string | null = null;
          for (const dlItem of dl.itens || []) { const d = (dlItem.numeroProcesso || '').replace(/\D/g, ''); if (remaining.has(d)) { matchedDigits = d; break; } }
          if (!matchedDigits) { const d = (dl.nomeArquivo || '').replace(/\D/g, ''); for (const [digits] of remaining) { if (d.includes(digits)) { matchedDigits = digits; break; } } }
          if (matchedDigits && dl.hashDownload) {
            const item = remaining.get(matchedDigits)!;
            try { const s3Url = await this.s3Collector.generateS3DownloadUrl(stored, dl.hashDownload); if (s3Url) { const file = await this.s3Collector.downloadFromS3(s3Url, item.proc.numeroProcesso, downloadDir); results.push({ processNumber: item.proc.numeroProcesso, file }); remaining.delete(matchedDigits); } } catch {}
          }
        }
      } catch {}
      if (remaining.size > 0) await sleep(Math.min(10000 + pollCount * 2500, 30000));
    }
    for (const [, item] of remaining) results.push({ processNumber: item.proc.numeroProcesso, error: 'Timeout' });
    return results;
  }
  private async fetchAvailableDownloads(stored: StoredSession): Promise<any[]> {
    const cookieStr = serializePjeCookies(stored.cookies);
    const headers = { ...buildPjeHeaders(stored as any), Cookie: cookieStr };
    const userId = stored.idUsuario || stored.idUsuarioLocalizacao;
    const url = `${PJE_REST_BASE}/pjedocs-api/v1/downloadService/recuperarDownloadsDisponiveis?idUsuario=${userId}&sistemaOrigem=PRIMEIRA_INSTANCIA`;
    try { const res = await fetch(url, { method: 'GET', headers }); if (res.ok) { const data = (await res.json()) as any; return data?.downloadsDisponiveis || []; } } catch {}
    return [];
  }
}
