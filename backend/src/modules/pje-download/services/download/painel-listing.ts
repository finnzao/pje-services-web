import { pjeApiPost, type PjeSession } from '../../../../shared/pje-api-client';

const PAGE_SIZE = 500;
const STAGGER_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Percorre recuperarProcessosTarefaPendenteComCriterios entregando cada linha crua.
// O nome da tarefa vai exatamente como o painel devolve (algumas têm espaço inicial).
export async function listarProcessosDaTarefa(
  session: PjeSession,
  taskName: string,
  isFavorite: boolean,
  onRow: (row: Record<string, unknown>) => void,
  onCancelled: () => boolean,
): Promise<void> {
  const encoded = encodeURIComponent(taskName);
  const endpoint = `painelUsuario/recuperarProcessosTarefaPendenteComCriterios/${encoded}/${isFavorite === true}`;
  let offset = 0;
  let coletados = 0;
  let esperados: number | undefined;

  while (true) {
    if (onCancelled()) return;
    const result = await pjeApiPost<{ entities?: unknown[]; count?: number } | unknown[]>(session, endpoint, {
      numeroProcesso: '', classe: null, tags: [],
      page: offset, maxResults: PAGE_SIZE, competencia: '',
    });
    const entities = Array.isArray(result) ? result : (result?.entities ?? []);
    if (!Array.isArray(result) && typeof result?.count === 'number') esperados ??= result.count;
    if (!Array.isArray(entities) || entities.length === 0) break;

    for (const e of entities) {
      if (e && typeof e === 'object') onRow(e as Record<string, unknown>);
    }
    coletados += entities.length;

    if (entities.length < PAGE_SIZE || (esperados !== undefined && coletados >= esperados)) break;
    offset += PAGE_SIZE;
    await sleep(STAGGER_MS);
  }

  if (esperados !== undefined && coletados < esperados) {
    console.warn(`[PAINEL] Tarefa "${taskName}": ${coletados}/${esperados} processos listados (paginação incompleta)`);
  }
}
