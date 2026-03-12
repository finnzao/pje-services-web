import {
  PJE_BASE, PJE_REST_BASE,
  pjeApiGet, serializeCookies, serializePjeCookies,
  buildPjeHeaders, type PjeSession,
} from '../../../../shared/pje-api-client';
import type { ProcessoInfo, DownloadStrategy } from './strategies/download-strategy';
import { ByTaskStrategy } from './strategies/by-task.strategy';
import { ByTagStrategy } from './strategies/by-tag.strategy';
import { ByNumberStrategy } from './strategies/by-number.strategy';

export interface ExtractResult {
  type: 'direct' | 'queued' | 'error';
  url?: string;
  fileSize?: number;
  error?: string;
}

export interface PendingProcess {
  proc: ProcessoInfo;
  requestedAt: number;
}

export interface CollectedUrl {
  processNumber: string;
  url?: string;
  error?: string;
}

const DOWNLOAD_AVAILABLE_STATUSES = ['S', 'DISPONIVEL', 'AVAILABLE'];
const DOWNLOAD_POLL_INITIAL = 5000;
const DOWNLOAD_TIMEOUT = 600000;

const strategies: Record<string, DownloadStrategy> = {
  by_task: new ByTaskStrategy(),
  by_tag: new ByTagStrategy(),
  by_number: new ByNumberStrategy(),
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class UrlExtractor {
  constructor(private session: PjeSession) {}

  async listProcesses(
    mode: string,
    params: {
      taskName?: string;
      tagId?: number;
      isFavorite?: boolean;
      processNumbers?: string[];
      onCancelled: () => boolean;
    },
  ): Promise<ProcessoInfo[]> {
    const strategy = strategies[mode];
    if (!strategy) throw new Error(`Modo desconhecido: ${mode}`);

    console.log(`[URL-EXTRACTOR] listProcesses mode=${mode} taskName="${params.taskName}" tagId=${params.tagId} isFavorite=${params.isFavorite}`);

    try {
      const result = await strategy.listProcesses(this.session, {
        taskName: params.taskName,
        tagId: params.tagId,
        isFavorite: params.isFavorite,
        processNumbers: params.processNumbers,
      } as Record<string, unknown>, params.onCancelled);

      console.log(`[URL-EXTRACTOR] listProcesses retornou ${result.length} processos`);
      if (result.length > 0) {
        console.log(`[URL-EXTRACTOR] Primeiro: ${result[0].numeroProcesso} (id=${result[0].idProcesso})`);
      }
      return result;
    } catch (err) {
      console.error(`[URL-EXTRACTOR] listProcesses ERRO:`, err instanceof Error ? err.message : err);
      throw err;
    }
  }

  async extractDownloadUrl(proc: ProcessoInfo): Promise<ExtractResult> {
    const { idProcesso, numeroProcesso, idTaskInstance } = proc;
    if (!idProcesso) return { type: 'error', error: 'idProcesso ausente' };

    try {
      const caRaw = await pjeApiGet<string>(
        this.session,
        `painelUsuario/gerarChaveAcessoProcesso/${idProcesso}`,
      );
      if (!caRaw || typeof caRaw !== 'string' || caRaw.length < 10) {
        return { type: 'error', error: `Chave de acesso inválida (${typeof caRaw}, len=${String(caRaw).length})` };
      }
      const ca = caRaw.replace(/^"|"$/g, '');

      const autosUrl = [
        `${PJE_BASE}/pje/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam`,
        `?idProcesso=${idProcesso}&ca=${ca}`,
        idTaskInstance ? `&idTaskInstance=${idTaskInstance}` : '',
      ].join('');

      const cookieStr = serializeCookies(this.session.cookies, 'pje.tjba.jus.br');
      const autosRes = await fetch(autosUrl, {
        method: 'GET',
        headers: {
          Cookie: cookieStr,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        redirect: 'follow',
      });
      const autosHtml = await autosRes.text();

      if (autosHtml.length < 500) {
        console.warn(`[URL-EXTRACTOR] ${numeroProcesso}: HTML muito curto (${autosHtml.length} chars)`);
      }

      const viewStateMatch = autosHtml.match(
        /javax\.faces\.ViewState[^>]+value="([^"]+)"/,
      );
      if (!viewStateMatch?.[1]) {
        return { type: 'error', error: `ViewState não encontrado (HTML ${autosHtml.length} chars)` };
      }

      const downloadBtnId = this.extractDownloadButtonId(autosHtml);
      if (!downloadBtnId) {
        return { type: 'error', error: 'Botão de download não encontrado' };
      }

      const now = new Date();
      const currentDate = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

      const postBody = new URLSearchParams({
        AJAXREQUEST: '_viewRoot',
        'navbar:cbTipoDocumento': '0',
        'navbar:idDe': '', 'navbar:idAte': '',
        'navbar:dtInicioInputDate': '',
        'navbar:dtInicioInputCurrentDate': currentDate,
        'navbar:dtFimInputDate': '',
        'navbar:dtFimInputCurrentDate': currentDate,
        'navbar:cbCronologia': 'DESC',
        '': 'on', navbar: 'navbar', autoScroll: '',
        'javax.faces.ViewState': viewStateMatch[1],
        [downloadBtnId]: downloadBtnId,
        'AJAX:EVENTS_COUNT': '1',
      });

      const downloadRes = await fetch(
        `${PJE_BASE}/pje/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Cookie: cookieStr,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest',
            'Faces-Request': 'partial/ajax',
          },
          body: postBody.toString(),
          redirect: 'follow',
        },
      );

      const responseHtml = await downloadRes.text();

      const s3Match = responseHtml.match(
        /window\.open\('(https:\/\/[^']*s3[^']*\.pdf[^']*?)'/,
      );
      if (s3Match?.[1]) {
        let fileSize: number | undefined;
        try {
          const head = await fetch(s3Match[1], { method: 'HEAD' });
          const cl = head.headers.get('content-length');
          if (cl) fileSize = parseInt(cl, 10);
        } catch { /* silent */ }

        return { type: 'direct', url: s3Match[1], fileSize };
      }

      const isQueued =
        responseHtml.includes('será disponibilizado') ||
        responseHtml.includes('será gerado') ||
        responseHtml.includes('está sendo gerado') ||
        responseHtml.includes('Área de download') ||
        /window\.open\(''\)/.test(responseHtml) ||
        responseHtml.length > 5000;

      if (isQueued) return { type: 'queued' };

      console.warn(`[URL-EXTRACTOR] ${numeroProcesso}: Resposta inesperada (${responseHtml.length} chars). Primeiros 500: ${responseHtml.slice(0, 500)}`);
      return { type: 'error', error: 'Resposta inesperada do PJE' };
    } catch (err) {
      return {
        type: 'error',
        error: err instanceof Error ? err.message : 'Erro ao extrair URL',
      };
    }
  }

  async collectPendingUrls(
    pending: PendingProcess[],
    isCancelled: () => boolean,
  ): Promise<CollectedUrl[]> {
    const results: CollectedUrl[] = [];
    if (pending.length === 0) return results;

    const remaining = new Map<string, PendingProcess>();
    for (const item of pending) {
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
        const downloads = await this.fetchAvailableDownloads();
        console.log(`[URL-EXTRACTOR] Poll #${pollCount}: ${downloads.length} downloads disponíveis, ${remaining.size} pendentes`);

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
              const s3Url = await this.generateS3DownloadUrl(dl.hashDownload);
              if (s3Url) {
                results.push({ processNumber: item.proc.numeroProcesso, url: s3Url });
                remaining.delete(matchedDigits);
                console.log(`[URL-EXTRACTOR] Coletado: ${item.proc.numeroProcesso}`);
              }
            } catch { /* silent */ }
          }
        }
      } catch { /* silent */ }

      if (remaining.size > 0) {
        const delay = Math.min(10000 + pollCount * 2500, 30000);
        await sleep(delay);
      }
    }

    for (const [, item] of remaining) {
      results.push({
        processNumber: item.proc.numeroProcesso,
        error: `Timeout (${Math.round(DOWNLOAD_TIMEOUT / 1000)}s) aguardando download`,
      });
    }

    return results;
  }

  private async fetchAvailableDownloads(): Promise<any[]> {
    const cookieStr = serializePjeCookies(this.session.cookies);
    const headers = { ...buildPjeHeaders(this.session), Cookie: cookieStr };
    const userId = this.session.idUsuario || this.session.idUsuarioLocalizacao;

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

  private async generateS3DownloadUrl(hashDownload: string): Promise<string | null> {
    const cookieStr = serializePjeCookies(this.session.cookies);
    const headers = { ...buildPjeHeaders(this.session), Cookie: cookieStr };

    const urls = [
      `${PJE_REST_BASE}/pjedocs-api/v2/repositorio/gerar-url-download?hashDownload=${encodeURIComponent(hashDownload)}`,
      `https://pje.tjba.jus.br/pje/seam/resource/rest/pjedocs-api/v2/repositorio/gerar-url-download?hashDownload=${encodeURIComponent(hashDownload)}`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'GET', headers });
        if (res.ok) {
          const s3Url = await res.text();
          return s3Url ? s3Url.replace(/^"|"$/g, '').trim() : null;
        }
      } catch { /* try next */ }
    }

    return null;
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
}
