import { pjeApiPost, type PjeSession } from '../../../../shared/pje-api-client';
import { parseDataPje } from '../planilha-digito/digito-core';

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

/** Nomes de todas as tarefas pendentes do painel do perfil da sessão (POST painelUsuario/tarefas). */
export async function listarNomesTarefasDoPainel(session: PjeSession): Promise<string[]> {
  const resposta = await pjeApiPost<unknown>(session, 'painelUsuario/tarefas', {
    numeroProcesso: '', competencia: '', etiquetas: [],
  });
  return (Array.isArray(resposta) ? resposta : [])
    .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>)['nome'] : undefined))
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
}

// ───────────────────── Parsers de linha do painel ─────────────────────

export function lerString(obj: Record<string, unknown>, chave: string): string | undefined {
  const v = obj[chave];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** Primeira data parseável entre as chaves informadas (aceita epoch, ISO ou dd/MM/yyyy). */
export function lerData(obj: Record<string, unknown>, ...chaves: string[]): string | undefined {
  for (const chave of chaves) {
    const parsed = parseDataPje(obj[chave]);
    if (parsed) return parsed;
  }
  return undefined;
}

/** Nomes das etiquetas da linha (tagsProcessoList[].nomeTag, com fallback em tagsList[]). */
export function lerEtiquetas(row: Record<string, unknown>): string[] {
  const lista = row['tagsProcessoList'];
  if (Array.isArray(lista)) {
    const nomes = lista
      .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>)['nomeTag'] : undefined))
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    if (nomes.length > 0) return nomes;
  }
  const tagsList = row['tagsList'];
  if (Array.isArray(tagsList)) {
    return tagsList.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  }
  return [];
}

/** Extrai a data do payload de processos/{id}/ultimoMovimento sem depender do formato exato. */
export function extrairDataMovimento(payload: unknown): string | undefined {
  const candidato = Array.isArray(payload) ? payload[0] : payload;
  const direto = parseDataPje(candidato);
  if (direto) return direto;
  if (candidato && typeof candidato === 'object') {
    const obj = candidato as Record<string, unknown>;
    for (const chave of ['dataMovimento', 'data', 'dataHora', 'dataUltimoMovimento', 'ultimoMovimento', 'dataCriacao']) {
      const parsed = parseDataPje(obj[chave]);
      if (parsed) return parsed;
    }
    const movimento = obj['movimento'];
    if (movimento && typeof movimento === 'object') return extrairDataMovimento(movimento);
  }
  return undefined;
}
