import type { DownloadStrategy, ProcessoInfo } from './download-strategy';
import {
  PJE_BASE, PJE_FRONTEND_ORIGIN, serializeCookies, type PjeSession,
} from '../../../../../shared/pje-api-client';
import type { PesquisaProcessoCriteria } from '../../../../../shared/types';
import {
  parseSearchForm, buildSearchBody, buildPageBody,
  parseResultRows, extractTotalPages, hasAnyCriteria,
} from '../consulta-publica';

const CONSULTA_URL = `${PJE_BASE}/pje/Processo/ConsultaProcesso/listView.seam`;
const CONSULTA_FORM_URL = `${CONSULTA_URL}?iframe=true`;
const MAX_PAGES = 200;
const PAGE_DELAY_MS = 400;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class BySearchStrategy implements DownloadStrategy {
  async listProcesses(
    session: PjeSession,
    params: Record<string, unknown>,
    onCancelled: () => boolean,
  ): Promise<ProcessoInfo[]> {
    const criteria = (params.searchCriteria as PesquisaProcessoCriteria) || {};
    if (!hasAnyCriteria(criteria)) {
      console.warn('[BY_SEARCH] Nenhum critério de pesquisa informado');
      return [];
    }

    const cookieStr = serializeCookies(session.cookies, 'pje.tjba.jus.br');

    const formHtml = await this.fetchText(CONSULTA_FORM_URL, cookieStr, { method: 'GET' });
    const form = parseSearchForm(formHtml);
    if (!form) {
      throw new Error('Formulário de consulta não encontrado (sessão pode ter expirado).');
    }

    const firstHtml = await this.fetchText(CONSULTA_URL, cookieStr, {
      method: 'POST',
      body: buildSearchBody(form, criteria).toString(),
    });

    const processos: ProcessoInfo[] = [];
    const seen = new Set<number>();
    const collect = (html: string): number => {
      let novos = 0;
      for (const p of parseResultRows(html)) {
        if (!seen.has(p.idProcesso)) {
          seen.add(p.idProcesso);
          processos.push(p);
          novos++;
        }
      }
      return novos;
    };

    collect(firstHtml);
    const totalPages = Math.min(extractTotalPages(firstHtml), MAX_PAGES);

    for (let page = 2; page <= totalPages; page++) {
      if (onCancelled()) break;
      await sleep(PAGE_DELAY_MS);
      const pageHtml = await this.fetchText(CONSULTA_URL, cookieStr, {
        method: 'POST',
        body: buildPageBody(form, criteria, page).toString(),
      });
      if (collect(pageHtml) === 0) break;
    }

    console.log(`[BY_SEARCH] ${processos.length} processo(s) encontrado(s) em ${totalPages} página(s)`);
    return processos;
  }

  private async fetchText(
    url: string,
    cookieStr: string,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<string> {
    const headers: Record<string, string> = {
      Cookie: cookieStr,
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (init.method === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['Origin'] = PJE_BASE;
      headers['Referer'] = CONSULTA_FORM_URL;
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers['Faces-Request'] = 'partial/ajax';
    } else {
      headers['Referer'] = `${PJE_FRONTEND_ORIGIN}/`;
    }
    const res = await fetch(url, { method: init.method, headers, body: init.body, redirect: 'follow' });
    return res.text();
  }
}
