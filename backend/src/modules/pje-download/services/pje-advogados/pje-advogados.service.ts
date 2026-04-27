import type {
  ProcessoAdvogados, FiltroAdvogado,
  PlanilhaAdvogadosProgress, PlanilhaAdvogadosResult,
  GerarPlanilhaAdvogadosDTO,
} from '../../../../shared/types';
import { PJEAuthProxy, sessionStore } from '../pje-auth';
import { extractAdvogadosFromHtml } from './html-advogados-parser';
import { gerarXlsx } from './xlsx-generator';
import {
  PJE_BASE, pjeApiGet, pjeApiPost,
  serializePjeCookies, type PjeSession,
} from '../../../../shared/pje-api-client';

const PAGE_SIZE = 500;
const EXTRACTION_CONCURRENCY = 4;
const STAGGER_MS = 250;

export class PjeAdvogadosService {
  private cancelledJobs = new Set<string>();
  private progressMap = new Map<string, PlanilhaAdvogadosProgress>();

  cancel(jobId: string): void { this.cancelledJobs.add(jobId); }
  isCancelled(jobId: string): boolean { return this.cancelledJobs.has(jobId); }
  getProgress(jobId: string): PlanilhaAdvogadosProgress | null { return this.progressMap.get(jobId) ?? null; }

  async gerar(jobId: string, _userId: number, dto: GerarPlanilhaAdvogadosDTO): Promise<PlanilhaAdvogadosResult> {
    const errors: Array<{ processo: string; message: string }> = [];
    const emit = (p: PlanilhaAdvogadosProgress) => this.progressMap.set(jobId, p);

    // Normaliza filtros: aceita tanto `filtro` (legado) quanto `filtros` (novo)
    const filtros: FiltroAdvogado[] = this.normalizeFiltros(dto);

    try {
      const session = await this.resolveSession(dto);

      emit({
        jobId, status: 'listing', progress: 5,
        totalProcesses: 0, processedCount: 0,
        message: 'Listando processos...', timestamp: Date.now(),
      });

      const processos = await this.listProcesses(session, dto, jobId);
      if (this.isCancelled(jobId)) return this.cancelledResult(jobId, processos.length, errors);

      if (processos.length === 0) {
        emit({
          jobId, status: 'completed', progress: 100,
          totalProcesses: 0, processedCount: 0,
          message: 'Nenhum processo encontrado.', timestamp: Date.now(),
        });
        return { jobId, totalProcesses: 0, processedCount: 0, filteredCount: 0, errors };
      }

      emit({
        jobId, status: 'extracting', progress: 10,
        totalProcesses: processos.length, processedCount: 0,
        message: `Extraindo advogados de ${processos.length} processos...`,
        timestamp: Date.now(),
      });

      const resultados = await this.extractParallel(
        session, processos, jobId, errors,
        (processed, current) => {
          const pct = 10 + Math.round((processed / processos.length) * 80);
          emit({
            jobId, status: 'extracting', progress: pct,
            totalProcesses: processos.length, processedCount: processed,
            currentProcess: current,
            message: `Extraindo ${processed}/${processos.length}: ${current}`,
            timestamp: Date.now(),
          });
        },
      );

      if (this.isCancelled(jobId)) return this.cancelledResult(jobId, processos.length, errors);

      const totalAdvogados = resultados.reduce(
        (acc, r) => acc + r.advogadosPoloAtivo.length + r.advogadosPoloPassivo.length, 0,
      );

      emit({
        jobId, status: 'generating', progress: 92,
        totalProcesses: processos.length, processedCount: resultados.length,
        message: 'Gerando planilha...', timestamp: Date.now(),
      });

      const { fileName, filePath, sheets } = await gerarXlsx(resultados, filtros);

      const filteredCount = filtros.length > 0
        ? this.countFiltered(resultados, filtros)
        : resultados.length;

      const sheetsInfo = sheets.length > 1 ? ` (${sheets.length} sheets)` : '';
      emit({
        jobId, status: 'completed', progress: 100,
        totalProcesses: processos.length, processedCount: resultados.length,
        message: `Planilha gerada${sheetsInfo}: ${resultados.length} processos, ${totalAdvogados} advogados.`,
        timestamp: Date.now(),
      });

      return {
        jobId,
        totalProcesses: processos.length,
        processedCount: resultados.length,
        filteredCount,
        fileName, filePath,
        errors,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao gerar planilha';
      emit({
        jobId, status: 'failed', progress: 0,
        totalProcesses: 0, processedCount: 0,
        message: msg, timestamp: Date.now(),
      });
      throw err;
    } finally {
      this.cancelledJobs.delete(jobId);
    }
  }

  private normalizeFiltros(dto: GerarPlanilhaAdvogadosDTO): FiltroAdvogado[] {
    const out: FiltroAdvogado[] = [];
    if (Array.isArray(dto.filtros)) {
      for (const f of dto.filtros) {
        if (f?.valor?.trim()) out.push({ tipo: f.tipo, valor: f.valor.trim() });
      }
    }
    if (dto.filtro?.valor?.trim()) {
      const f = { tipo: dto.filtro.tipo, valor: dto.filtro.valor.trim() };
      if (!out.some((x) => x.tipo === f.tipo && x.valor.toLowerCase() === f.valor.toLowerCase())) {
        out.push(f);
      }
    }
    return out;
  }

  private async resolveSession(dto: GerarPlanilhaAdvogadosDTO): Promise<PjeSession> {
    if (dto.pjeSessionId) {
      const existing = sessionStore.get(dto.pjeSessionId);
      if (existing) return existing as unknown as PjeSession;
    }
    const proxy = new PJEAuthProxy();
    const loginResult = await proxy.login(dto.credentials.cpf, dto.credentials.password);
    if (loginResult.error || !loginResult.sessionId) {
      throw new Error(loginResult.error || 'Falha na autenticacao');
    }
    if (dto.pjeProfileIndex !== undefined) {
      await proxy.selectProfile(loginResult.sessionId, dto.pjeProfileIndex);
    }
    const stored = sessionStore.get(loginResult.sessionId);
    if (!stored) throw new Error('Sessao nao encontrada apos login');
    return stored as unknown as PjeSession;
  }

  private async listProcesses(
    session: PjeSession,
    dto: GerarPlanilhaAdvogadosDTO,
    jobId: string,
  ): Promise<ProcessoAdvogados[]> {
    const processos: ProcessoAdvogados[] = [];
    const seenIds = new Set<number>();

    if (dto.fonte === 'by_task' && dto.taskName) {
      const encoded = encodeURIComponent(dto.taskName.trim());
      const endpoint = `painelUsuario/recuperarProcessosTarefaPendenteComCriterios/${encoded}/${dto.isFavorite === true}`;
      let offset = 0;
      while (true) {
        if (this.isCancelled(jobId)) break;
        const result = await pjeApiPost<any>(session, endpoint, {
          numeroProcesso: '', classe: null, tags: [],
          page: offset, maxResults: PAGE_SIZE, competencia: '',
        });
        const entities = result?.entities || (Array.isArray(result) ? result : []);
        if (entities.length === 0) break;
        for (const e of entities) {
          if (e.idProcesso && !seenIds.has(e.idProcesso)) {
            seenIds.add(e.idProcesso);
            processos.push(mapProcesso(e));
          }
        }
        if (entities.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        await sleep(300);
      }
    } else if (dto.fonte === 'by_tag' && dto.tagId) {
      const totalStr = await pjeApiGet<string>(
        session, `painelUsuario/etiquetas/${dto.tagId}/processos/total`,
      );
      const total = parseInt(String(totalStr), 10) || 0;
      let offset = 0;
      while (offset < total) {
        if (this.isCancelled(jobId)) break;
        const entities = await pjeApiGet<any[]>(
          session,
          `painelUsuario/etiquetas/${dto.tagId}/processos?limit=${PAGE_SIZE}&offset=${offset}`,
        );
        const arr = Array.isArray(entities) ? entities : [];
        if (arr.length === 0) break;
        for (const e of arr) {
          if (e.idProcesso && !seenIds.has(e.idProcesso)) {
            seenIds.add(e.idProcesso);
            processos.push(mapProcesso(e));
          }
        }
        if (arr.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
        await sleep(300);
      }
    }
    return processos;
  }

  /**
   * Extrai advogados em paralelo com pool de concorrência limitada.
   * Cada processo faz 2 requests sequenciais (chave de acesso + HTML),
   * mas múltiplos processos rodam em paralelo respeitando EXTRACTION_CONCURRENCY.
   */
  private async extractParallel(
    session: PjeSession,
    processos: ProcessoAdvogados[],
    jobId: string,
    errors: Array<{ processo: string; message: string }>,
    onProgress: (processed: number, current: string) => void,
  ): Promise<ProcessoAdvogados[]> {
    const resultados: ProcessoAdvogados[] = new Array(processos.length);
    let processed = 0;
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        if (this.isCancelled(jobId)) return;
        const idx = nextIndex++;
        if (idx >= processos.length) return;
        const proc = processos[idx];
        if (idx > 0) await sleep(STAGGER_MS);
        try {
          const enriquecido = await this.extractAdvogados(session, proc);
          resultados[idx] = enriquecido;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Erro desconhecido';
          errors.push({ processo: proc.numeroProcesso, message: msg });
          resultados[idx] = { ...proc, advogadosPoloAtivo: [], advogadosPoloPassivo: [], erro: msg };
        }
        processed++;
        onProgress(processed, proc.numeroProcesso);
      }
    };

    const workers = Array.from(
      { length: Math.min(EXTRACTION_CONCURRENCY, processos.length) },
      () => worker(),
    );
    await Promise.all(workers);

    // Garante que slots vazios (caso de cancelamento) recebam fallback
    for (let i = 0; i < processos.length; i++) {
      if (!resultados[i]) {
        resultados[i] = {
          ...processos[i],
          advogadosPoloAtivo: [], advogadosPoloPassivo: [],
          erro: 'Cancelado',
        };
      }
    }
    return resultados;
  }

  private async extractAdvogados(session: PjeSession, proc: ProcessoAdvogados): Promise<ProcessoAdvogados> {
    const caRaw = await pjeApiGet<string>(
      session, `painelUsuario/gerarChaveAcessoProcesso/${proc.idProcesso}`,
    );
    const ca = (typeof caRaw === 'string' ? caRaw : '').replace(/^"|"$/g, '');
    if (!ca || ca.length < 10) throw new Error('Chave de acesso invalida');

    const url = `${PJE_BASE}/pje/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam?idProcesso=${proc.idProcesso}&ca=${ca}&aba=`;
    const cookieStr = serializePjeCookies(session.cookies);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html',
        Referer: `${PJE_BASE}/pje/Processo/ConsultaProcesso/listView.seam`,
        Cookie: cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (html.length < 500) throw new Error(`HTML muito curto (${html.length} chars)`);
    if ((html.includes('login.seam') || html.includes('kc-form-login')) && !html.includes('poloAtivo')) {
      throw new Error('Sessao PJE expirada');
    }

    const { advogadosPoloAtivo, advogadosPoloPassivo } = extractAdvogadosFromHtml(html);
    return { ...proc, advogadosPoloAtivo, advogadosPoloPassivo };
  }

  private countFiltered(processos: ProcessoAdvogados[], filtros: FiltroAdvogado[]): number {
    const matchesAny = (p: ProcessoAdvogados): boolean => {
      const todos = [...p.advogadosPoloAtivo, ...p.advogadosPoloPassivo];
      return filtros.some((f) => {
        if (f.tipo === 'oab') {
          const alvo = (f.valor || '').toUpperCase().replace('OAB', '').replace(/[\s\-./]/g, '');
          return todos.some((a) => a.oab && a.oab.toUpperCase().replace('OAB', '').replace(/[\s\-./]/g, '') === alvo);
        }
        const alvo = f.valor.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return todos.some((a) => a.nome.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(alvo));
      });
    };
    return processos.filter(matchesAny).length;
  }

  private cancelledResult(
    jobId: string, total: number,
    errors: Array<{ processo: string; message: string }>,
  ): PlanilhaAdvogadosResult {
    return { jobId, totalProcesses: total, processedCount: 0, filteredCount: 0, errors };
  }
}

function mapProcesso(e: any): ProcessoAdvogados {
  return {
    idProcesso: e.idProcesso,
    numeroProcesso: e.numeroProcesso || '',
    poloAtivo: e.poloAtivo || '',
    poloPassivo: e.poloPassivo || '',
    classeJudicial: e.classeJudicial,
    assuntoPrincipal: e.assuntoPrincipal,
    orgaoJulgador: e.orgaoJulgador,
    advogadosPoloAtivo: [],
    advogadosPoloPassivo: [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
