import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerPJEDownloadModule } from './modules/pje-download';
import { errorHandler } from './middleware/error-handler';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PORT = parseInt(process.env.PORT || '10000', 10);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const ALLOWED_ORIGINS: (string | RegExp)[] = IS_PRODUCTION
  ? [
      'https://pje-services-web-frontend.vercel.app',
      /\.vercel\.app$/,
    ]
  : ['http://localhost:3000', 'http://localhost:3001'];

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

function formatMb(bytes: number): string {
  return (bytes / 1048576).toFixed(0);
}

async function main() {
  const fastify = Fastify({
    logger: {
      level: IS_PRODUCTION ? 'info' : (process.env.LOG_LEVEL || 'info'),
      transport: !IS_PRODUCTION
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
    },
  });

  await fastify.register(cors, {
    origin: IS_PRODUCTION ? ALLOWED_ORIGINS : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user', 'X-User'],
    exposedHeaders: ['Content-Length', 'Content-Disposition'],
    credentials: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  });

  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  fastify.setErrorHandler(errorHandler);

  fastify.addHook('onResponse', async (req, reply) => {
    if (req.url.includes('/api/pje')) {
      const ms = (reply.elapsedTime ?? 0).toFixed(0);
      fastify.log.info(`${req.method} ${reply.statusCode} ${req.url.split('?')[0]} (${ms}ms)`);
    }
  });

  const memTimer = setInterval(() => {
    const m = process.memoryUsage();
    fastify.log.info(`[mem] rss=${formatMb(m.rss)}MB heapUsed=${formatMb(m.heapUsed)}MB/${formatMb(m.heapTotal)}MB`);
  }, 30_000);
  if (typeof memTimer.unref === 'function') memTimer.unref();
  fastify.addHook('onClose', () => clearInterval(memTimer));

  fastify.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rssMb: formatMb(process.memoryUsage().rss),
    env: IS_PRODUCTION ? 'production' : 'development',
  }));

  await registerPJEDownloadModule(fastify);

  const downloadCleanup = setInterval(() => {
    try {
      const dirs = [
        path.join(process.cwd(), 'downloads'),
        path.join(process.cwd(), 'downloads', 'planilhas'),
      ];
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.mtimeMs < oneHourAgo) {
            fs.unlinkSync(filePath);
          }
        }
      }
    } catch { /* silent */ }
  }, 30 * 60 * 1000);

  fastify.addHook('onClose', () => clearInterval(downloadCleanup));

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log('------------------------------------------------');
  console.log(`  API PJE  |  porta ${PORT}  |  ${IS_PRODUCTION ? 'PRODUCAO' : 'DEV'}`);
  console.log(`  http://localhost:${PORT}/api/health`);
  console.log('------------------------------------------------');
}

main().catch((err) => { console.error('Erro fatal ao iniciar API:', err); process.exit(1); });
