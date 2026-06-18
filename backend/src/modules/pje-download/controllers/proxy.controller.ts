import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const FRONTEND_ORIGIN = 'https://pje-services-web-frontend.vercel.app';
const URL_TTL_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_STREAMS = 4;

const urlCache = new Map<string, { url: string; processNumber?: string; expiresAt: number }>();

let activeStreams = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeStreams < MAX_CONCURRENT_STREAMS) {
    activeStreams++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot(): void {
  activeStreams = Math.max(0, activeStreams - 1);
  const next = waiters.shift();
  if (next) {
    activeStreams++;
    next();
  }
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of urlCache) {
    if (now > entry.expiresAt) urlCache.delete(token);
  }
}, 60_000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

export function registerProxyUrl(s3Url: string, processNumber?: string): string {
  const token = randomUUID().replace(/-/g, '').slice(0, 16);
  urlCache.set(token, { url: s3Url, processNumber, expiresAt: Date.now() + URL_TTL_MS });
  return token;
}

function corsHeaders(origin?: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': IS_PRODUCTION ? FRONTEND_ORIGIN : (origin || '*'),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition',
    'Vary': 'Origin',
  };
}

export async function proxyRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { token: string } }>('/proxy/:token', async (request, reply) => {
    const { token } = request.params;
    const entry = urlCache.get(token);
    const origin = request.headers.origin as string | undefined;

    if (!entry || Date.now() > entry.expiresAt) {
      urlCache.delete(token);
      request.log.warn(`[PROXY] token expirado/invalido: ${token}`);
      return reply.status(410).send({ success: false, error: { code: 'URL_EXPIRED', message: 'URL expirada.', statusCode: 410 } });
    }

    const label = entry.processNumber || token;
    const t0 = Date.now();
    const ac = new AbortController();
    request.raw.on('close', () => ac.abort());

    await acquireSlot();
    let slotReleased = false;
    const releaseOnce = () => { if (!slotReleased) { slotReleased = true; releaseSlot(); } };

    let upstream: Response;
    try {
      upstream = await fetch(entry.url, { redirect: 'follow', signal: ac.signal });
    } catch (err) {
      releaseOnce();
      urlCache.delete(token);
      if (!ac.signal.aborted) {
        request.log.error({ err }, `[PROXY] x falha ao conectar no S3 (${label})`);
        if (!reply.sent) return reply.status(502).send({ success: false, error: { code: 'PROXY_ERROR', message: 'Erro ao conectar no S3.', statusCode: 502 } });
      }
      return;
    }

    if (!upstream.ok || !upstream.body) {
      releaseOnce();
      urlCache.delete(token);
      request.log.error(`[PROXY] x S3 respondeu ${upstream.status} (${label})`);
      return reply.status(502).send({ success: false, error: { code: 'UPSTREAM_ERROR', message: `S3 respondeu ${upstream.status}.`, statusCode: 502 } });
    }

    const contentLength = upstream.headers.get('content-length');
    const sizeMb = contentLength ? (parseInt(contentLength, 10) / 1048576).toFixed(1) : '?';
    request.log.info(`[PROXY] > ${label} (${sizeMb} MB) [${activeStreams}/${MAX_CONCURRENT_STREAMS}]`);

    const head: Record<string, string> = {
      'Content-Type': upstream.headers.get('content-type') || 'application/pdf',
      'Content-Disposition': 'attachment',
      ...corsHeaders(origin),
    };
    if (contentLength) head['Content-Length'] = contentLength;

    reply.hijack();
    reply.raw.writeHead(200, head);

    const nodeStream = Readable.fromWeb(upstream.body as any);

    try {
      await pipeline(nodeStream, reply.raw);
      request.log.info(`[PROXY] ok ${label} (${Date.now() - t0}ms)`);
    } catch (err) {
      ac.abort();
      if (!reply.raw.writableEnded) { try { reply.raw.destroy(); } catch { } }
      if (!ac.signal.aborted) request.log.warn(`[PROXY] stream interrompido ${label} (${Date.now() - t0}ms)`);
    } finally {
      urlCache.delete(token);
      releaseOnce();
    }
  });
}
