import type { FastifyInstance } from 'fastify';
import { etiquetasRoutes } from './etiquetas.controller';
import { EtiquetasScheduler } from './etiquetas.scheduler';
import { EtiquetasService } from './etiquetas.service';

export { EtiquetasService } from './etiquetas.service';
export { EtiquetasScheduler } from './etiquetas.scheduler';
export { configStore } from './config-store';
export { execucoesStore } from './execucoes-store';
export * from './types';

/**
 * Serviço "Etiquetas": rotina automática (worker in-process) que aplica uma etiqueta
 * do PJE em processos parados há mais de N dias, com blacklist de tarefas.
 * Rotas em /api/pje/etiquetas. O agendador é desligado com ETIQUETAS_SCHEDULER=off.
 */
export async function registerEtiquetasModule(fastify: FastifyInstance) {
  const service = new EtiquetasService();
  const scheduler = new EtiquetasScheduler(service);

  await fastify.register(etiquetasRoutes(service, scheduler), { prefix: '/api/pje/etiquetas' });

  if (process.env.ETIQUETAS_SCHEDULER !== 'off') scheduler.start();
  else fastify.log.warn('[ETIQUETAS] Agendador desligado por ETIQUETAS_SCHEDULER=off');

  fastify.addHook('onClose', async () => scheduler.stop());
}
