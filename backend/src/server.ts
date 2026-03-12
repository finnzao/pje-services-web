import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerPJEDownloadModule } from './modules/pje-download';
import { errorHandler } from './middleware/error-handler';

const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info', transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } : undefined },
  });
  await fastify.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'x-user', 'X-User'], credentials: true });
  fastify.setErrorHandler(errorHandler);
  fastify.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), storage: 'memory' }));
  await registerPJEDownloadModule(fastify);
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  fastify.log.info(`API rodando na porta ${PORT} (storage: memory)`);
}

main().catch((err) => { console.error('Erro fatal ao iniciar API:', err); process.exit(1); });
