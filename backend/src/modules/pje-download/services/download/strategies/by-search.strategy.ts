import type { DownloadStrategy, ProcessoInfo } from './download-strategy';
import type { PjeSession } from '../../../../../shared/pje-api-client';
import type { PesquisaProcessoCriteria } from '../../../../../shared/types';
import {
  consultaFetchForm, consultaPost, extractViewState, validateCriteria,
  buildSearchBody, buildPaginationBody, parseResultRows, parseResultCount,
  RESULTS_PER_PAGE, MAX_RESULTS,
} from '../consulta-publica';

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
    const validacao = validateCriteria(criteria);
    if (!validacao.ok) throw new Error(validacao.error || 'Critérios inválidos.');

    const formHtml = await consultaFetchForm(session);
    const viewState = extractViewState(formHtml) || 'j_id38';

    const firstHtml = await consultaPost(session, buildSearchBody(criteria, viewState));
    const resultsViewState = extractViewState(firstHtml) || viewState;
    const total = Math.min(parseResultCount(firstHtml) || 0, MAX_RESULTS);

    const seen = new Set<string>();
    const processos: ProcessoInfo[] = [];

    const pushRows = (html: string): void => {
      for (const row of parseResultRows(html)) {
        if (!row.idProcesso || seen.has(row.idProcesso)) continue;
        seen.add(row.idProcesso);
        processos.push({ idProcesso: parseInt(row.idProcesso, 10), numeroProcesso: row.numeroProcesso });
      }
    };

    pushRows(firstHtml);

    const totalPages = total > 0 ? Math.ceil(total / RESULTS_PER_PAGE) : 1;
    for (let page = 2; page <= totalPages; page++) {
      if (onCancelled()) break;
      const html = await consultaPost(session, buildPaginationBody(criteria, resultsViewState, page));
      const before = processos.length;
      pushRows(html);
      if (processos.length === before) break;
      await sleep(300);
    }

    return processos;
  }
}
