import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const urlCache = new Map<string, { url: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of urlCache) {
    if (now > entry.expiresAt) urlCache.delete(token);
  }
}, 60_000);

export function registerProxyUrl(s3Url: string): string {
  const token = randomUUID().replace(/-/g, '').slice(0, 16);
  urlCache.set(token, { url: s3Url, expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

export async function proxyRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { token: string } }>('/proxy/:token', async (request, reply) => {
    const entry = urlCache.get(request.params.token);
    if (!entry || Date.now() > entry.expiresAt) {
      urlCache.delete(request.params.token);
      return reply.status(410).send({ success: false, error: { code: 'URL_EXPIRED', message: 'URL expirada.', statusCode: 410 } });
    }
    try {
      const upstream = await fetch(entry.url, { redirect: 'follow' });
      if (!upstream.ok || !upstream.body) return reply.status(502).send({ success: false, error: { code: 'UPSTREAM_ERROR', message: 'Falha ao obter PDF do PJE.', statusCode: 502 } });
      const contentLength = upstream.headers.get('content-length');
      const contentType = upstream.headers.get('content-type') || 'application/pdf';
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', 'attachment');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');
      if (contentLength) reply.header('Content-Length', contentLength);
      const nodeStream = Readable.fromWeb(upstream.body as any);
      return reply.send(nodeStream);
    } catch (err) {
      request.log.error({ err }, 'Erro no proxy de download');
      return reply.status(502).send({ success: false, error: { code: 'PROXY_ERROR', message: 'Erro ao fazer proxy.', statusCode: 502 } });
    } finally {
      urlCache.delete(request.params.token);
    }
  });
}
