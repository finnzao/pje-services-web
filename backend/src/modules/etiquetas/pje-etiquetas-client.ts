/**
 * Chamadas REST do PJE relacionadas a etiquetas (contratos observados no painel do
 * frontend.cloud.pje.jus.br, HAR de 09/2026):
 *
 *   POST painelUsuario/etiquetas              {page, maxResults, tagsString}  → {count, entities[]}
 *   POST painelUsuario/processoTags/inserir   {tag: nomeTag, idProcesso: "123"} → {id, nomeTag, idUsuario, idProcesso, idProcessoTag}
 *   POST painelUsuario/processoTags/remover   {idTag, idProcesso}              → idTag (número)
 */
import { pjeApiGet, pjeApiPost, type PjeSession } from '../../shared/pje-api-client';
import { extrairDataMovimento } from '../pje-download/services/download/painel-listing';
import type { EtiquetaPje } from './types';

const TAGS_PAGE_SIZE = 500;

export async function listarEtiquetasDoPerfil(session: PjeSession): Promise<EtiquetaPje[]> {
  const out: EtiquetaPje[] = [];
  let page = 0;
  while (true) {
    const res = await pjeApiPost<{ count?: number; entities?: unknown[] } | string>(
      session, 'painelUsuario/etiquetas', { page, maxResults: TAGS_PAGE_SIZE, tagsString: '' },
    );
    if (!res || typeof res === 'string') break;
    const entities = Array.isArray(res.entities) ? res.entities : [];
    for (const e of entities) {
      if (!e || typeof e !== 'object') continue;
      const t = e as Record<string, unknown>;
      if (typeof t.id !== 'number' || typeof t.nomeTag !== 'string') continue;
      out.push({
        id: t.id,
        nomeTag: t.nomeTag,
        nomeTagCompleto: typeof t.nomeTagCompleto === 'string' ? t.nomeTagCompleto : t.nomeTag,
        favorita: t.favorita === true,
      });
    }
    const total = typeof res.count === 'number' ? res.count : out.length;
    if (entities.length < TAGS_PAGE_SIZE || out.length >= total) break;
    page += 1;
  }
  return out;
}

export interface InserirEtiquetaResult { idProcessoTag: number; idTag: number; }

/** Vincula a etiqueta (pelo nome) ao processo. O PJE cria a tag se o nome não existir — por isso o serviço só usa nomes já listados. */
export async function inserirEtiquetaNoProcesso(
  session: PjeSession, nomeTag: string, idProcesso: number,
): Promise<InserirEtiquetaResult> {
  const res = await pjeApiPost<unknown>(session, 'painelUsuario/processoTags/inserir', {
    tag: nomeTag,
    idProcesso: String(idProcesso),
  });
  if (res && typeof res === 'object') {
    const r = res as Record<string, unknown>;
    if (typeof r.idProcessoTag === 'number' && typeof r.id === 'number') {
      return { idProcessoTag: r.idProcessoTag, idTag: r.id };
    }
    throw new Error(`Resposta inesperada ao inserir etiqueta: ${JSON.stringify(res).slice(0, 200)}`);
  }
  throw new Error(`Resposta inesperada ao inserir etiqueta: ${String(res).slice(0, 200)}`);
}

/** Desvincula a etiqueta do processo. O PJE responde com o próprio idTag. */
export async function removerEtiquetaDoProcesso(
  session: PjeSession, idTag: number, idProcesso: number,
): Promise<void> {
  const res = await pjeApiPost<unknown>(session, 'painelUsuario/processoTags/remover', { idTag, idProcesso });
  const ok = (typeof res === 'number' && res === idTag)
    || (typeof res === 'string' && res.trim() === String(idTag));
  if (!ok) throw new Error(`Resposta inesperada ao remover etiqueta: ${String(typeof res === 'object' ? JSON.stringify(res) : res).slice(0, 200)}`);
}

/** Data da última movimentação via GET processos/{id}/ultimoMovimento (fallback quando a listagem não traz). */
export async function consultarDataUltimoMovimento(session: PjeSession, idProcesso: number): Promise<string | undefined> {
  const payload = await pjeApiGet<unknown>(session, `processos/${idProcesso}/ultimoMovimento`);
  return extrairDataMovimento(payload);
}
