import type { DownloadStrategy, ProcessoInfo } from './download-strategy';
import type { PjeSession } from '../../../../../shared/pje-api-client';
import { pjeApiGet } from '../../../../../shared/pje-api-client';
import { sleep } from '../../../../../shared/abortable';

const PAGE_SIZE = 500;

export class ByTagStrategy implements DownloadStrategy {
  async listProcesses(
    session: PjeSession,
    params: Record<string, unknown>,
    onCancelled: () => boolean,
    signal?: AbortSignal,
  ): Promise<ProcessoInfo[]> {
    const tagId = params.tagId as number;
    if (!tagId) return [];

    const totalStr = await pjeApiGet<string>(session, `painelUsuario/etiquetas/${tagId}/processos/total`, signal);
    const total = parseInt(String(totalStr), 10) || 0;
    if (total === 0) return [];

    const processos: ProcessoInfo[] = [];
    let offset = 0;

    while (offset < total) {
      if (onCancelled()) break;

      const result = await pjeApiGet<any[]>(session, `painelUsuario/etiquetas/${tagId}/processos?limit=${PAGE_SIZE}&offset=${offset}`, signal);
      const entities = Array.isArray(result) ? result : [];
      if (entities.length === 0) break;

      for (const p of entities) {
        if (p.numeroProcesso) {
          processos.push({
            idProcesso: p.idProcesso || 0,
            numeroProcesso: p.numeroProcesso,
          });
        }
      }

      if (entities.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      await sleep(500, signal);
    }

    return processos;
  }
}
