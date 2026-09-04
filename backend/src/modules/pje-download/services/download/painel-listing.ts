import { pjeApiPost, type PjeSession } from '../../../../shared/pje-api-client';

const PAGE_SIZE = 500;
const STAGGER_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Percorre a paginação de recuperarProcessosTarefaPendenteComCriterios para
 * uma tarefa do painel, entregando cada linha crua ao mapeador do chamador.
 * A dedup entre tarefas fica a cargo do chamador (via seenIds).
 */
export async function listarProcessosDaTarefa(
  session: PjeSession,
  taskName: string,
  isFavorite: boolean,
  onRow: (row: Record<string, unknown>) => void,
  onCancelled: () => boolean,
): Promise<void> {
  const encoded = encodeURIComponent(taskName.trim());
  const endpoint = `painelUsuario/recuperarProcessosTarefaPendenteComCriterios/${encoded}/${isFavorite === true}`;
  let offset = 0;

  while (true) {
    if (onCancelled()) return;
    const result = await pjeApiPost<{ entities?: unknown[] } | unknown[]>(session, endpoint, {
      numeroProcesso: '', classe: null, tags: [],
      page: offset, maxResults: PAGE_SIZE, competencia: '',
    });
    const entities = Array.isArray(result) ? result : (result?.entities ?? []);
    if (!Array.isArray(entities) || entities.length === 0) return;

    for (const e of entities) {
      if (e && typeof e === 'object') onRow(e as Record<string, unknown>);
    }

    if (entities.length < PAGE_SIZE) return;
    offset += PAGE_SIZE;
    await sleep(STAGGER_MS);
  }
}
