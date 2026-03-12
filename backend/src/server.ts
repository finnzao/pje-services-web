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

async function main() {
  const fastify = Fastify({
    logger: {
      level: IS_PRODUCTION ? 'info' : (process.env.LOG_LEVEL || 'info'),
      transport: !IS_PRODUCTION
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
    },
  });

  // CORS — DEVE vir ANTES do helmet
  await fastify.register(cors, {
    origin: IS_PRODUCTION ? ALLOWED_ORIGINS : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user', 'X-User'],
    credentials: true,
  });

  // Security headers — DEPOIS do CORS
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  });

  // Rate limiting
  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  fastify.setErrorHandler(errorHandler);

  // Health check (Render/Railway + UptimeRobot)
  fastify.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: IS_PRODUCTION ? 'production' : 'development',
  }));

  await registerPJEDownloadModule(fastify);

  // Cleanup old downloads every 30 min
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
  fastify.log.info(`API rodando na porta ${PORT} (${IS_PRODUCTION ? 'production' : 'development'})`);
}

main().catch((err) => { console.error('Erro fatal ao iniciar API:', err); process.exit(1); });