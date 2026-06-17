import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sessionStore } from '../services/pje-auth';
import { UrlExtractor, type PendingProcess } from '../services/download/url-extractor';
import { registerProxyUrl } from './proxy.controller';
import {
  serializeCookies, serializeAllCookies, buildPjeHeaders,
  PJE_REST_BASE, PJE_FRONTEND_ORIGIN, PJE_LEGACY_APP,
} from '../../../shared/pje-api-client';
import { ParallelPool } from '../../../shared/parallel-pool';
import {
  expandSelectedTypes,
  SELECIONE_SENTINEL,
  listDocumentTypes,
} from '../../../shared/tipos-documento';
import {
  consultaFetchForm, consultaPost, extractViewState, validateCriteria,
  buildSearchBody, buildPaginationBody, buildNosAtuaisBody,
  parseResultRowsFull, parseResultCount, parseNosAtuais, parseFormOptions,
  RESULTS_PER_PAGE, MAX_RESULTS,
} from '../services/download/consulta-publica';
import type { PesquisaProcessoCriteria } from '../../../shared/types';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CORS_ORIGIN = IS_PRODUCTION ? 'https://pje-services-web-frontend.vercel.app' : '*';

const PARALLEL_SLOTS = 3;
const REQUEST_STAGGER_MS = 500;
const MAX_STREAMS_PER_USER = 1;
const MAX_STREAMS_GLOBAL = 5;
const NOS_STAGGER_MS = 200;

const activeStreams = new Map<string, { count: number; startedAt: number }>();
const streamRegistry = new Map<string, { cancel: () => void }>();

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function validatePjeSession(session: any): Promise<boolean> {
  try {
    const cookieStr = serializeCookies(session.cookies, 'pje.tjba.jus.br');
    const allCookieStr = serializeAllCookies(session.cookies);
    const res = await fetch(`${PJE_REST_BASE}/usuario/currentUser`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-pje-legacy-app': PJE_LEGACY_APP, 'Origin': PJE_FRONTEND_ORIGIN, 'Referer': `${PJE_FRONTEND_ORIGIN}/`, 'X-pje-cookies': allCookieStr, 'X-pje-usuario-localizacao': session.idUsuarioLocalizacao, 'Cookie': cookieStr },
    });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return false;
    const user = await res.json() as any;
    if (!user?.idUsuario || user.idUsuario === 0) return false;
    session.idUsuario = user.idUsuario;
    return true;
  } catch { return false; }
}

function releaseStream(userId: string): void {
  const entry = activeStreams.get(userId);
  if (entry) { entry.count--; if (entry.count <= 0) activeStreams.delete(userId); }
}

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
  };
}

interface StreamContext { extractor: UrlExtractor; send: (event: string, data: unknown) => void; cancelled: () => boolean; }
interface BatchResult { processNumber: string; type: 'success' | 'queued' | 'error' | 'not_available'; documentType?: string; }

async function processOneRequest(
  ctx: StreamContext,
  proc: { idProcesso: number; numeroProcesso: string; idTaskInstance?: number },
  documentTypeName: string,
  documentTypeId: string,
  index: number,
  total: number,
): Promise<BatchResult> {
  const { extractor, send, cancelled } = ctx;
  if (cancelled()) {
    return { processNumber: proc.numeroProcesso, type: 'error', documentType: documentTypeName };
  }

  const isAllTypes = documentTypeName === SELECIONE_SENTINEL;
  const typeLabel = isAllTypes ? '' : ` [${documentTypeName}]`;

  send('progress', {
    index: index + 1, total,
    processNumber: proc.numeroProcesso,
    documentType: isAllTypes ? null : documentTypeName,
    status: 'requesting',
  });

  try {
    const result = await extractor.extractDownloadUrl(proc, {
      documentTypeId,
      documentType: isAllTypes ? undefined : documentTypeName,
    });

    if (result.type === 'direct' && result.url) {
      const proxyToken = registerProxyUrl(result.url);
      const proxyUrl = `/api/pje/downloads/proxy/${proxyToken}`;
      const suffix = isAllTypes ? '' : `_${documentTypeName.replace(/\s+/g, '_')}`;
      const fileName = `${proc.numeroProcesso}${suffix}.pdf`;
      send('url', {
        processNumber: proc.numeroProcesso,
        documentType: isAllTypes ? null : documentTypeName,
        downloadUrl: result.url,
        proxyUrl,
        fileName,
        fileSize: result.fileSize,
        method: 'direct',
      });
      return { processNumber: proc.numeroProcesso, type: 'success', documentType: documentTypeName };
    }

    if (result.type === 'queued') {
      send('queued', {
        processNumber: proc.numeroProcesso,
        documentType: isAllTypes ? null : documentTypeName,
        message: `${proc.numeroProcesso}${typeLabel}: aguardando PJE gerar PDF...`,
        estimatedWait: 30,
      });
      return { processNumber: proc.numeroProcesso, type: 'queued', documentType: documentTypeName };
    }

    if (result.type === 'not_available') {
      send('not_available', {
        processNumber: proc.numeroProcesso,
        documentType: isAllTypes ? null : documentTypeName,
        message: result.error || 'Tipo não disponível neste processo',
      });
      return { processNumber: proc.numeroProcesso, type: 'not_available', documentType: documentTypeName };
    }

    send('item_error', {
      processNumber: proc.numeroProcesso,
      documentType: isAllTypes ? null : documentTypeName,
      message: result.error || 'Erro desconhecido',
      code: 'EXTRACT_FAILED',
    });
    return { processNumber: proc.numeroProcesso, type: 'error', documentType: documentTypeName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro';
    send('item_error', {
      processNumber: proc.numeroProcesso,
      documentType: isAllTypes ? null : documentTypeName,
      message: msg,
      code: 'UNEXPECTED',
    });
    return { processNumber: proc.numeroProcesso, type: 'error', documentType: documentTypeName };
  }
}

async function collectPending(
  ctx: StreamContext, pendingQueue: PendingProcess[],
): Promise<{ success: number; failed: number }> {
  if (pendingQueue.length === 0 || ctx.cancelled()) return { success: 0, failed: 0 };
  let success = 0; let failed = 0;
  const collected = await ctx.extractor.collectPendingUrls(pendingQueue, ctx.cancelled);
  for (const item of collected) {
    if (item.url) {
      const proxyToken = registerProxyUrl(item.url);
      const suffix = item.documentType
        ? `_${item.documentType.replace(/\s+/g, '_')}`
        : '';
      const fileName = `${item.processNumber}${suffix}.pdf`;
      ctx.send('url', {
        processNumber: item.processNumber,
        documentType: item.documentType ?? null,
        downloadUrl: item.url,
        proxyUrl: `/api/pje/downloads/proxy/${proxyToken}`,
        fileName,
        method: 'polled',
      });
      success++;
    } else {
      ctx.send('item_error', {
        processNumber: item.processNumber,
        documentType: item.documentType ?? null,
        message: item.error || 'Timeout',
        code: 'POLL_TIMEOUT',
      });
      failed++;
    }
  }
  return { success, failed };
}

function parseCriteriaQuery(raw: string | undefined): PesquisaProcessoCriteria {
  if (!raw) return {};
  try { return JSON.parse(raw) as PesquisaProcessoCriteria; } catch { return {}; }
}

export async function streamRoutes(fastify: FastifyInstance) {

  fastify.get('/document-types', async (_request, reply) => {
    const types = listDocumentTypes();
    reply.status(200).send({ success: true, data: types });
  });

  fastify.post<{ Params: { streamId: string } }>(
    '/stream-batch/:streamId/cancel', async (request, reply) => {
      const entry = streamRegistry.get(request.params.streamId);
      if (!entry) {
        return reply.status(404).send({ success: false, error: { code: 'STREAM_NOT_FOUND', message: 'Stream não encontrado ou já finalizado.', statusCode: 404 } });
      }
      entry.cancel();
      reply.status(200).send({ success: true, data: { streamId: request.params.streamId, cancelling: true }, timestamp: new Date().toISOString() });
    },
  );

  fastify.get<{ Querystring: { sessionId: string } }>(
    '/search-form-options', async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId } = request.query as any;
      if (!sessionId) return reply.status(400).send({ success: false, error: { code: 'MISSING_SESSION', message: 'sessionId é obrigatório.', statusCode: 400 } });
      const session = sessionStore.get(sessionId);
      if (!session) return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Sessão PJE expirada.', statusCode: 401 } });
      try {
        const html = await consultaFetchForm(session as any);
        const options = parseFormOptions(html);
        reply.status(200).send({ success: true, data: options });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar formulário';
        reply.status(502).send({ success: false, error: { code: 'FORM_ERROR', message: msg, statusCode: 502 } });
      }
    },
  );

  fastify.get<{ Querystring: {
    sessionId: string; mode: string;
    taskName?: string; tagId?: string; isFavorite?: string;
    processNumbers?: string; documentTypes?: string; criteria?: string;
  } }>(
    '/stream-batch', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as any;
      const { sessionId, mode, taskName, tagId, isFavorite, processNumbers, documentTypes, criteria } = query;

      if (!sessionId) return reply.status(400).send({ success: false, error: { code: 'MISSING_SESSION', message: 'sessionId é obrigatório.', statusCode: 400 } });
      const session = sessionStore.get(sessionId);
      if (!session) return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Sessão PJE expirada.', statusCode: 401 } });

      const sessionValid = await validatePjeSession(session);
      if (!sessionValid) { sessionStore.delete(sessionId); return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Sessão PJE expirada no servidor.', statusCode: 401 } }); }

      const userId = session.cpf || sessionId.slice(0, 16);
      let totalActive = 0;
      for (const entry of activeStreams.values()) totalActive += entry.count;
      if (totalActive >= MAX_STREAMS_GLOBAL) return reply.status(429).send({ success: false, error: { code: 'SERVER_BUSY', message: `Servidor ocupado.`, statusCode: 429 } });
      const userEntry = activeStreams.get(userId);
      if (userEntry && userEntry.count >= MAX_STREAMS_PER_USER) return reply.status(429).send({ success: false, error: { code: 'USER_LIMIT', message: 'Você já tem um download em andamento.', statusCode: 429 } });
      activeStreams.set(userId, { count: (userEntry?.count || 0) + 1, startedAt: Date.now() });

      const streamId = randomUUID();
      let cancelled = false;
      streamRegistry.set(streamId, { cancel: () => { cancelled = true; } });

      reply.hijack();
      reply.raw.writeHead(200, sseHeaders());
      reply.raw.write('retry: 60000\n\n');
      const send = (event: string, data: unknown) => { try { reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {  } };

      const heartbeat = setInterval(() => { try { reply.raw.write(': ping\n\n'); } catch {  } }, 15000);

      let finalized = false;
      const finalizeStream = () => {
        if (finalized) return;
        finalized = true;
        clearInterval(heartbeat);
        streamRegistry.delete(streamId);
        releaseStream(userId);
        try { reply.raw.end(); } catch {  }
      };

      request.raw.on('close', () => { cancelled = true; finalizeStream(); });

      send('init', { streamId });

      try {
        const extractor = new UrlExtractor(session);
        send('auth', { status: 'ok', user: session.idUsuarioLocalizacao });

        const processNumbersArray = processNumbers
          ? processNumbers.split(',').map((n: string) => n.trim()).filter(Boolean)
          : undefined;

        const documentTypesArray = documentTypes
          ? documentTypes.split(',').map((t: string) => t.trim()).filter(Boolean)
          : [];

        const tipoPares = expandSelectedTypes(documentTypesArray);
        const totalTipos = tipoPares.length;

        const processos = await extractor.listProcesses(mode, {
          taskName, tagId: tagId ? parseInt(tagId, 10) : undefined,
          isFavorite: isFavorite === 'true',
          processNumbers: processNumbersArray,
          searchCriteria: parseCriteriaQuery(criteria),
          onCancelled: () => cancelled,
        });

        send('listing', {
          total: processos.length,
          parallelSlots: PARALLEL_SLOTS,
          documentTypes: tipoPares.map(([nome]) => nome),
          totalRequests: processos.length * totalTipos,
        });

        if (processos.length === 0 || cancelled) {
          if (cancelled) send('cancelled', { reason: 'user', stage: 'listing' });
          send('done', { total: processos.length, success: 0, failed: 0, queued: 0, notAvailable: 0, elapsed: 0, cancelled });
          finalizeStream();
          return;
        }

        const startTime = Date.now();
        let success = 0; let failed = 0; let notAvailable = 0;
        const pendingQueue: PendingProcess[] = [];
        const ctx: StreamContext = { extractor, send, cancelled: () => cancelled };
        const pool = new ParallelPool(PARALLEL_SLOTS);
        const PENDING_BATCH_THRESHOLD = 10;

        const totalRequests = processos.length * totalTipos;
        let requestIndex = 0;

        for (let i = 0; i < processos.length; i++) {
          if (cancelled) break;
          const proc = processos[i];

          for (let t = 0; t < totalTipos; t++) {
            if (cancelled) break;
            const [tipoNome, tipoId] = tipoPares[t];
            const idx = requestIndex++;

            if (idx > 0) await sleep(REQUEST_STAGGER_MS);
            if (cancelled) break;

            await pool.add(async () => {
              const result = await processOneRequest(ctx, proc, tipoNome, tipoId, idx, totalRequests);
              if (result.type === 'success') success++;
              else if (result.type === 'queued') pendingQueue.push({ proc, requestedAt: Date.now(), documentType: tipoNome === SELECIONE_SENTINEL ? undefined : tipoNome });
              else if (result.type === 'not_available') notAvailable++;
              else failed++;
            });

            if (pendingQueue.length >= PENDING_BATCH_THRESHOLD) {
              const batch = pendingQueue.splice(0, pendingQueue.length);
              pool.add(async () => {
                const r = await collectPending(ctx, batch);
                success += r.success;
                failed += r.failed;
              });
            }
          }
        }

        await pool.drain();
        if (pendingQueue.length > 0 && !cancelled) {
          const r = await collectPending(ctx, pendingQueue.splice(0, pendingQueue.length));
          success += r.success;
          failed += r.failed;
        }
        const elapsed = Date.now() - startTime;
        if (cancelled) send('cancelled', { reason: 'user', stage: 'downloading', success, failed, notAvailable });
        send('done', {
          total: processos.length,
          totalRequests: requestIndex,
          success, failed, queued: 0, notAvailable, elapsed, cancelled,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro fatal';
        send('fatal', { message: msg });
      } finally {
        finalizeStream();
      }
    },
  );

  fastify.get<{ Querystring: { sessionId: string; criteria?: string } }>(
    '/search-sheet-stream', async (request: FastifyRequest, reply: FastifyReply) => {
      const { sessionId, criteria } = request.query as any;

      if (!sessionId) return reply.status(400).send({ success: false, error: { code: 'MISSING_SESSION', message: 'sessionId é obrigatório.', statusCode: 400 } });
      const session = sessionStore.get(sessionId);
      if (!session) return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Sessão PJE expirada.', statusCode: 401 } });

      const sessionValid = await validatePjeSession(session);
      if (!sessionValid) { sessionStore.delete(sessionId); return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Sessão PJE expirada no servidor.', statusCode: 401 } }); }

      const userId = session.cpf || sessionId.slice(0, 16);
      let totalActive = 0;
      for (const entry of activeStreams.values()) totalActive += entry.count;
      if (totalActive >= MAX_STREAMS_GLOBAL) return reply.status(429).send({ success: false, error: { code: 'SERVER_BUSY', message: 'Servidor ocupado.', statusCode: 429 } });
      const userEntry = activeStreams.get(userId);
      if (userEntry && userEntry.count >= MAX_STREAMS_PER_USER) return reply.status(429).send({ success: false, error: { code: 'USER_LIMIT', message: 'Você já tem uma operação em andamento.', statusCode: 429 } });
      activeStreams.set(userId, { count: (userEntry?.count || 0) + 1, startedAt: Date.now() });

      const streamId = randomUUID();
      let cancelled = false;
      streamRegistry.set(streamId, { cancel: () => { cancelled = true; } });

      reply.hijack();
      reply.raw.writeHead(200, sseHeaders());
      reply.raw.write('retry: 60000\n\n');
      const send = (event: string, data: unknown) => { try { reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {  } };

      const heartbeat = setInterval(() => { try { reply.raw.write(': ping\n\n'); } catch {  } }, 15000);

      let finalized = false;
      const finalizeStream = () => {
        if (finalized) return;
        finalized = true;
        clearInterval(heartbeat);
        streamRegistry.delete(streamId);
        releaseStream(userId);
        try { reply.raw.end(); } catch {  }
      };

      request.raw.on('close', () => { cancelled = true; finalizeStream(); });

      send('init', { streamId });

      try {
        const criterios = parseCriteriaQuery(criteria);
        const validacao = validateCriteria(criterios);
        if (!validacao.ok) {
          send('fatal', { message: validacao.error || 'Critérios inválidos.' });
          finalizeStream();
          return;
        }

        const formHtml = await consultaFetchForm(session as any);
        const formViewState = extractViewState(formHtml) || 'j_id38';

        const firstHtml = await consultaPost(session as any, buildSearchBody(criterios, formViewState));
        const resultsViewState = extractViewState(firstHtml) || formViewState;
        const total = Math.min(parseResultCount(firstHtml) || 0, MAX_RESULTS);

        const seen = new Set<string>();
        const linhas = parseResultRowsFull(firstHtml).filter((r) => {
          if (!r.idProcesso || seen.has(r.idProcesso)) return false;
          seen.add(r.idProcesso);
          return true;
        });

        const totalPages = total > 0 ? Math.ceil(total / RESULTS_PER_PAGE) : 1;
        for (let page = 2; page <= totalPages; page++) {
          if (cancelled) break;
          const html = await consultaPost(session as any, buildPaginationBody(criterios, resultsViewState, page));
          const novas = parseResultRowsFull(html).filter((r) => {
            if (!r.idProcesso || seen.has(r.idProcesso)) return false;
            seen.add(r.idProcesso);
            return true;
          });
          if (novas.length === 0) break;
          linhas.push(...novas);
          await sleep(300);
        }

        send('listing', { total: linhas.length, parallelSlots: PARALLEL_SLOTS });

        if (linhas.length === 0 || cancelled) {
          if (cancelled) send('cancelled', { reason: 'user', stage: 'listing' });
          send('done', { total: linhas.length, cancelled });
          finalizeStream();
          return;
        }

        const pool = new ParallelPool(PARALLEL_SLOTS);
        let emitted = 0;

        for (let i = 0; i < linhas.length; i++) {
          if (cancelled) break;
          const linha = linhas[i];
          if (i > 0) await sleep(NOS_STAGGER_MS);
          if (cancelled) break;
          await pool.add(async () => {
            let noAtual = '';
            try {
              const body = buildNosAtuaisBody(criterios, resultsViewState, linha.idProcesso, linha.nosContainer, linha.nosSingle);
              const respHtml = await consultaPost(session as any, body);
              noAtual = parseNosAtuais(respHtml);
            } catch {  }
            emitted++;
            send('row', {
              index: emitted,
              total: linhas.length,
              numeroProcesso: linha.numeroProcesso,
              orgaoJulgador: linha.orgaoJulgador,
              autuadoEm: linha.autuadoEm,
              classeJudicial: linha.classeJudicial,
              poloAtivo: linha.poloAtivo,
              poloPassivo: linha.poloPassivo,
              noAtual,
              ultimaMovimentacao: linha.ultimaMovimentacao,
            });
          });
        }

        await pool.drain();
        if (cancelled) send('cancelled', { reason: 'user', stage: 'collecting' });
        send('done', { total: linhas.length, cancelled });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro fatal';
        send('fatal', { message: msg });
      } finally {
        finalizeStream();
      }
    },
  );
}
