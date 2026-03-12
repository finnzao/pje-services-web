import type { FastifyInstance } from 'fastify';
import { MemoryDownloadRepository } from './repositories/download.repository.memory';
import { PJEDownloadService } from './services/pje-download.service';

import { PJEDownloadWorker } from './services/download/download.worker';
import { PjeAdvogadosService } from './services/pje-advogados/index';
import { authRoutes } from './controllers/auth.controller';
import { jobsRoutes } from './controllers/jobs.controller';
import { advogadosRoutes } from './controllers/advogados.controller';
import { streamRoutes } from './controllers/stream.controller';
import { proxyRoutes } from './controllers/proxy.controller';

export async function registerPJEDownloadModule(fastify: FastifyInstance) {
  const repository = new MemoryDownloadRepository();
  const service = new PJEDownloadService(repository);
  const worker = new PJEDownloadWorker(service, repository);
  worker.start();

  await fastify.register(authRoutes, { prefix: '/api/pje/downloads/auth' });
  await fastify.register(jobsRoutes(service), { prefix: '/api/pje/downloads' });
  await fastify.register(streamRoutes, { prefix: '/api/pje/downloads' });
  await fastify.register(proxyRoutes, { prefix: '/api/pje/downloads' });

  const advogadosService = new PjeAdvogadosService();
  await fastify.register(advogadosRoutes(advogadosService), { prefix: '/api/pje/advogados' });

  const cleanupInterval = setInterval(() => service.cleanup(), 10 * 60 * 1000);
  fastify.addHook('onClose', () => { clearInterval(cleanupInterval); worker.stop(); });
}
