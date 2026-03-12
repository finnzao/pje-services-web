import type { PJEDownloadedFile } from 'shared';
import { serializePjeCookies, serializeAllCookies, buildPjeHeaders, PJE_REST_BASE } from '../../../../../shared/pje-api-client';
import { S3Collector } from './s3-collector';

const DOWNLOAD_AVAILABLE_STATUSES = ['S', 'DISPONIVEL', 'AVAILABLE'];
const DOWNLOAD_POLL_INTERVAL = 10000;
const DOWNLOAD_POLL_INITIAL = 5000;
const DOWNLOAD_TIMEOUT = 600000;

interface StoredSession {
  cookies: Record<string, string>;
  idUsuarioLocalizacao: string;
  idUsuario?: number;
}

interface PendingItem {
  proc: { idProcesso: number; numeroProcesso: string };
  requestedAt: number;
}

interface CollectResult {
  processNumber: string;
  file?: PJEDownloadedFile;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class PendingDownloadCollector {
  private s3Collector = new S3Collector();

  async collectPendingDownloads(
    stored: StoredSession,
    pendingList: PendingItem[],
    isCancelled: () => boolean,
    downloadDir: string,
  ): Promise<CollectResult[]> {
    const results: CollectResult[] = [];
    if (pendingList.length === 0) return results;

    const remaining = new Map<string, PendingItem>();
    for (const item of pendingList) {
      const digits = item.proc.numeroProcesso.replace(/\D/g, '');
      remaining.set(digits, item);
    }

    await sleep(DOWNLOAD_POLL_INITIAL);

    const startTime = Date.now();
    let pollCount = 0;

    while (remaining.size > 0 && Date.now() - startTime < DOWNLOAD_TIMEOUT) {
      if (isCancelled()) break;
      pollCount++;

      try {
        const downloads = await this.fetchAvailableDownloads(stored);

        for (const dl of downloads) {
          const status = (dl.situacaoDownload || '').toUpperCase();
          if (!DOWNLOAD_AVAILABLE_STATUSES.includes(status)) continue;

          let matchedDigits: string | null = null;

          for (const dlItem of dl.itens || []) {
            const itemDigits = (dlItem.numeroProcesso || '').replace(/\D/g, '');
            if (remaining.has(itemDigits)) { matchedDigits = itemDigits; break; }
            if (dlItem.idProcesso && [...remaining.values()].some((r) => r.proc.idProcesso === dlItem.idProcesso)) {
              const found = [...remaining.entries()].find(([, r]) => r.proc.idProcesso === dlItem.idProcesso);
              if (found) { matchedDigits = found[0]; break; }
            }
          }

          if (!matchedDigits) {
            const dlDigits = dl.nomeArquivo.replace(/\D/g, '');
            for (const [digits] of remaining) {
              if (dlDigits.includes(digits)) { matchedDigits = digits; break; }
            }
          }

          if (matchedDigits && dl.hashDownload) {
            const item = remaining.get(matchedDigits)!;
            try {
              const s3Url = await this.s3Collector.generateS3DownloadUrl(stored, dl.hashDownload);
              if (s3Url) {
                const file = await this.s3Collector.downloadFromS3(s3Url, item.proc.numeroProcesso, downloadDir);
                results.push({ processNumber: item.proc.numeroProcesso, file });
                remaining.delete(matchedDigits);
              }
            } catch { /* silent */ }
          }
        }
      } catch { /* silent */ }

      if (remaining.size > 0) {
        const delay = Math.min(DOWNLOAD_POLL_INTERVAL + pollCount * 2500, 30000);
        await sleep(delay);
      }
    }

    for (const [, item] of remaining) {
      results.push({
        processNumber: item.proc.numeroProcesso,
        error: `Timeout (${Math.round(DOWNLOAD_TIMEOUT / 1000)}s) aguardando download ficar disponível`,
      });
    }

    return results;
  }

  private async fetchAvailableDownloads(stored: StoredSession): Promise<any[]> {
    const cookieStr = serializePjeCookies(stored.cookies);
    const headers = { ...buildPjeHeaders(stored as any), Cookie: cookieStr };
    const userId = stored.idUsuario || stored.idUsuarioLocalizacao;

    const urls = [
      `${PJE_REST_BASE}/pjedocs-api/v1/downloadService/recuperarDownloadsDisponiveis?idUsuario=${userId}&sistemaOrigem=PRIMEIRA_INSTANCIA`,
      `https://pje.tjba.jus.br/pje/seam/resource/rest/pjedocs-api/v1/downloadService/recuperarDownloadsDisponiveis?idUsuario=${userId}&sistemaOrigem=PRIMEIRA_INSTANCIA`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'GET', headers });
        if (res.ok) {
          const data = (await res.json()) as any;
          return data?.downloadsDisponiveis || [];
        }
      } catch { /* try next */ }
    }

    return [];
  }
}
