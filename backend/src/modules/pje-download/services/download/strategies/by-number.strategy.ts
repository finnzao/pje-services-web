import type { DownloadStrategy, ProcessoInfo } from './download-strategy';
import { pjeApiPost, pjeApiGet, type PjeSession } from '../../../../../shared/pje-api-client';

const CNJ_PATTERN = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const PAGE_SIZE = 30;

interface CamposFiltroTarefa {
  numeroProcesso: string;
  classe: null; tags: never[]; tagsString: null;
  poloAtivo: null; poloPassivo: null; orgao: null; ordem: null;
  page: number; maxResults: number; idTaskInstance: null;
  apelidoSessao: null; idTipoSessao: null; dataSessao: null;
  somenteFavoritas: null; objeto: null; semEtiqueta: null;
  assunto: null; dataAutuacao: null; nomeParte: null; nomeFiltro: null;
  numeroDocumento: null; competencia: string; relator: null;
  orgaoJulgador: null; somenteLembrete: null; somenteSigiloso: null;
  somenteLiminar: null; eleicao: null; estado: null; municipio: null;
  prioridadeProcesso: null; cpfCnpj: null; porEtiqueta: null;
  conferidos: null; orgaoJulgadorColegiado: null; naoLidos: null;
  tipoProcessoDocumento: null;
}

function buildBody(numero: string, page = 0): CamposFiltroTarefa {
  return {
    numeroProcesso: numero,
    classe: null, tags: [], tagsString: null,
    poloAtivo: null, poloPassivo: null, orgao: null, ordem: null,
    page, maxResults: PAGE_SIZE, idTaskInstance: null,
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
}

function normalizarNumeroCNJ(numero: string): string | null {
  const trimmed = (numero || '').trim();
  if (!trimmed) return null;
  if (CNJ_PATTERN.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 20) return null;
  return (
    `${digits.slice(0, 7)}-${digits.slice(7, 9)}.` +
    `${digits.slice(9, 13)}.${digits.slice(13, 14)}.` +
    `${digits.slice(14, 16)}.${digits.slice(16, 20)}`
  );
}

export class ByNumberStrategy implements DownloadStrategy {
  async listProcesses(
    session: PjeSession,
    params: Record<string, unknown>,
    onCancelled: () => boolean,
  ): Promise<ProcessoInfo[]> {
    const raw: string[] = (params.processNumbers as string[]) || [];
    if (raw.length === 0) return [];

    const numeros = raw
      .map((n) => normalizarNumeroCNJ(n))
      .filter((n): n is string => Boolean(n));

    if (numeros.length === 0) {
      console.warn('[BY_NUMBER] Nenhum número CNJ válido após normalização');
      return [];
    }

    console.log(`[BY_NUMBER] Descobrindo ${numeros.length} processos via painel_filtrado`);

    const resultados: ProcessoInfo[] = [];
    const naoEncontrados: string[] = [];

    for (const numero of numeros) {
      if (onCancelled()) break;

      const encontrado = await this.descobrirProcesso(session, numero);
      if (encontrado) {
        resultados.push(encontrado);
        console.log(`[BY_NUMBER] ✓ ${numero} → idProcesso=${encontrado.idProcesso}, idTaskInstance=${encontrado.idTaskInstance ?? 'none'}`);
      } else {
        naoEncontrados.push(numero);
        console.warn(`[BY_NUMBER] ✗ ${numero}: não encontrado no painel`);
      }
    }

    if (naoEncontrados.length > 0) {
      console.warn(`[BY_NUMBER] ${naoEncontrados.length}/${numeros.length} processos não encontrados: ${naoEncontrados.slice(0, 5).join(', ')}${naoEncontrados.length > 5 ? '...' : ''}`);
    }

    return resultados;
  }

  private async descobrirProcesso(session: PjeSession, numero: string): Promise<ProcessoInfo | null> {

    try {
      const tarefas = await pjeApiPost<any[]>(
        session, 'painelUsuario/tarefas',
        { numeroProcesso: numero, competencia: '', etiquetas: [] },
      );

      const tarefasArr = Array.isArray(tarefas) ? tarefas : [];
      if (tarefasArr.length > 0) {
        for (const tarefa of tarefasArr) {
          const nomeTarefa = tarefa?.nome;
          if (!nomeTarefa) continue;

          const encoded = encodeURIComponent(nomeTarefa);
          const endpoint = `painelUsuario/recuperarProcessosTarefaPendenteComCriterios/${encoded}/false`;

          try {
            const result = await pjeApiPost<any>(session, endpoint, buildBody(numero, 0));
            const entities = result?.entities || (Array.isArray(result) ? result : []);

            for (const e of entities) {
              const digitsBuscado = numero.replace(/\D/g, '');
              const digitsRetornado = (e.numeroProcesso || '').replace(/\D/g, '');
              if (digitsRetornado === digitsBuscado && e.idProcesso) {
                return {
                  idProcesso: e.idProcesso,
                  numeroProcesso: e.numeroProcesso || numero,
                  idTaskInstance: e.idTaskInstance,
                };
              }
            }
          } catch (err) {
            console.warn(`[BY_NUMBER] Falha ao buscar em "${nomeTarefa}": ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[BY_NUMBER] painel_filtrado falhou para ${numero}: ${err instanceof Error ? err.message : err}`);
    }

    const apiEndpoints: Array<{ method: 'GET' | 'POST'; path: string; body?: any }> = [
      { method: 'GET', path: `consultaProcessual/processo/${encodeURIComponent(numero)}` },
      { method: 'GET', path: `processo/numero/${encodeURIComponent(numero)}` },
      { method: 'POST', path: 'painelUsuario/buscarProcessos', body: { numeroProcesso: numero, page: 0, maxResults: 10 } },
      { method: 'POST', path: 'consultaProcessual/pesquisar', body: { numeroProcesso: numero } },
    ];

    for (const ep of apiEndpoints) {
      try {
        const result = ep.method === 'GET'
          ? await pjeApiGet<any>(session, ep.path)
          : await pjeApiPost<any>(session, ep.path, ep.body);

        if (!result || typeof result === 'string') continue;

        const candidates: any[] = Array.isArray(result)
          ? result
          : result.entities && Array.isArray(result.entities)
            ? result.entities
            : [result];

        for (const e of candidates) {
          const id = e?.idProcesso ?? e?.id ?? e?.idProcessoTrf;
          if (!id) continue;
          const digitsBuscado = numero.replace(/\D/g, '');
          const digitsRetornado = (e?.numeroProcesso || '').replace(/\D/g, '');

          if (!e?.numeroProcesso || digitsRetornado === digitsBuscado) {
            return {
              idProcesso: id,
              numeroProcesso: e?.numeroProcesso || numero,
              idTaskInstance: e?.idTaskInstance,
            };
          }
        }
      } catch {

      }
    }

    return null;
  }
}
