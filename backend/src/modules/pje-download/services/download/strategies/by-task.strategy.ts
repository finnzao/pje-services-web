import type { DownloadStrategy, ProcessoInfo } from './download-strategy';
import type { PjeSession } from '../../../../../shared/pje-api-client';
import { pjeApiPost } from '../../../../../shared/pje-api-client';

const PAGE_SIZE = 500;
const MAX_TOTAL = 10000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ByTaskStrategy implements DownloadStrategy {
  async listProcesses(
    session: PjeSession,
    params: Record<string, unknown>,
    onCancelled: () => boolean,
  ): Promise<ProcessoInfo[]> {
    const taskName = ((params.taskName as string) || '').trim();
    const isFavorite = params.isFavorite === true;

    if (!taskName) return [];

    const encodedName = encodeURIComponent(taskName);
    const endpoint = `painelUsuario/recuperarProcessosTarefaPendenteComCriterios/${encodedName}/${isFavorite}`;

    const body = {
      numeroProcesso: '', classe: null, tags: [], tagsString: null,
      poloAtivo: null, poloPassivo: null, orgao: null, ordem: null,
      page: 0, maxResults: PAGE_SIZE, idTaskInstance: null,
      apelidoSessao: null, idTipoSessao: null, dataSessao: null,
      somenteFavoritas: null, objeto: null, semEtiqueta: null,
      assunto: null, dataAutuacao: null, nomeParte: null, nomeFiltro: null,
      numeroDocumento: null, competencia: '', relator: null,
      orgaoJulgador: null, somenteLembrete: null, somenteSigiloso: null,
      somenteLiminar: null, eleicao: null, estado: null, municipio: null,
      prioridadeProcesso: null, cpfCnpj: null, porEtiqueta: null,
      conferidos: null, orgaoJulgadorColegiado: null, naoLidos: null,
      tipoProcessoDocumento: null,
    };

    const seenIds = new Set<number>();
    const processos: ProcessoInfo[] = [];

    const result = await pjeApiPost<any>(session, endpoint, body);
    if (result === null || result === undefined) return [];
    if (typeof result === 'string') return [];

    const entities = result?.entities || (Array.isArray(result) ? result : []);
    const totalFromApi = result?.count ?? entities.length;

    for (const p of entities) {
      if (p.numeroProcesso && !seenIds.has(p.idProcesso)) {
        seenIds.add(p.idProcesso);
        processos.push({
          idProcesso: p.idProcesso || 0,
          numeroProcesso: p.numeroProcesso,
          idTaskInstance: p.idTaskInstance,
        });
      }
    }

    if (totalFromApi > PAGE_SIZE && entities.length >= PAGE_SIZE) {
      let offset = PAGE_SIZE;
      const totalExpected = Math.min(totalFromApi, MAX_TOTAL);

      while (offset < totalExpected) {
        if (onCancelled()) break;

        const nextBody = { ...body, page: offset };
        const nextResult = await pjeApiPost<any>(session, endpoint, nextBody);
        const nextEntities = nextResult?.entities || (Array.isArray(nextResult) ? nextResult : []);

        if (nextEntities.length === 0) break;

        let novos = 0;
        for (const p of nextEntities) {
          if (p.numeroProcesso && !seenIds.has(p.idProcesso)) {
            seenIds.add(p.idProcesso);
            processos.push({
              idProcesso: p.idProcesso || 0,
              numeroProcesso: p.numeroProcesso,
              idTaskInstance: p.idTaskInstance,
            });
            novos++;
          }
        }

        if (novos === 0 || nextEntities.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        await sleep(500);
      }
    }

    return processos;
  }
}
