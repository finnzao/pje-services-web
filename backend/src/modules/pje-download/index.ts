import type { FastifyInstance } from 'fastify';
import { PjeAdvogadosService } from './services/pje-advogados/index';
import { PlanilhaDigitoService } from './services/planilha-digito/index';
import { authRoutes } from './controllers/auth.controller';
import { advogadosRoutes } from './controllers/advogados.controller';
import { planilhaDigitoRoutes } from './controllers/planilha-digito.controller';
import { streamRoutes } from './controllers/stream.controller';
import { proxyRoutes } from './controllers/proxy.controller';

export async function registerPJEDownloadModule(fastify: FastifyInstance) {
  await fastify.register(authRoutes, { prefix: '/api/pje/downloads/auth' });
  await fastify.register(streamRoutes, { prefix: '/api/pje/downloads' });
  await fastify.register(proxyRoutes, { prefix: '/api/pje/downloads' });

  const advogadosService = new PjeAdvogadosService();
  await fastify.register(advogadosRoutes(advogadosService), { prefix: '/api/pje/advogados' });

  const planilhaDigitoService = new PlanilhaDigitoService();
  await fastify.register(planilhaDigitoRoutes(planilhaDigitoService), { prefix: '/api/pje/planilha-digito' });
}
