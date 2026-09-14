import type { FastifyInstance } from 'fastify';
import { authMiddleware, getUser } from '../../middleware/auth';
import { AppError } from '../../shared/errors';
import { handleServiceError, ok } from '../../shared/response';
import { listarNomesTarefasDoPainel } from '../pje-download/services/download/painel-listing';
import { configStore } from './config-store';
import { execucoesStore } from './execucoes-store';
import type { EtiquetasScheduler } from './etiquetas.scheduler';
import type { EtiquetasService } from './etiquetas.service';
import { listarEtiquetasDoPerfil } from './pje-etiquetas-client';
import type { ExecutarEtiquetasDTO } from './types';

interface SessaoQuery { pjeSessionId?: string; }

/**
 * Rotas do serviço "Etiquetas" — prefixo /api/pje/etiquetas.
 *
 *   GET    /config                       configuração vigente
 *   PUT    /config                       patch parcial validado (diasParado, etiqueta, tarefasIgnoradas, horaExecucao, ativo, ...)
 *   GET    /status                       estado do agendador (próxima execução, sessão vinculada, última execução)
 *   GET    /disponiveis?pjeSessionId=    etiquetas do perfil da sessão (para escolher qual aplicar)
 *   GET    /tarefas?pjeSessionId=        tarefas do painel (para montar a blacklist)
 *   POST   /executar                     {dryRun?, pjeSessionId?, credentials?} → 202 {execucaoId}
 *   GET    /execucoes                    histórico (sem lista de processos)
 *   GET    /execucoes/:id                execução completa (progresso + processos afetados)
 *   DELETE /execucoes/:id                cancela a execução em andamento
 */
export function etiquetasRoutes(service: EtiquetasService, scheduler: EtiquetasScheduler) {
  return async function (fastify: FastifyInstance) {
    fastify.addHook('preHandler', authMiddleware({ requiredRole: 'magistrado' }));

    fastify.get('/config', async (_request, reply) => {
      ok(reply, configStore.get());
    });

    fastify.put('/config', async (request, reply) => {
      const { config, erros } = configStore.atualizar(request.body, getUser(request)?.name);
      if (!config) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CONFIG_INVALIDA', message: erros.join(' '), statusCode: 400, details: erros },
        });
      }
      ok(reply, config);
    });

    fastify.get('/status', async (_request, reply) => {
      ok(reply, await scheduler.status());
    });

    fastify.get<{ Querystring: SessaoQuery }>('/disponiveis', async (request, reply) => {
      try {
        const session = await service.resolverSessao(configStore.get().sessao, { pjeSessionId: request.query.pjeSessionId });
        ok(reply, await listarEtiquetasDoPerfil(session));
      } catch (err) {
        return handleServiceError(err, request, reply);
      }
    });

    fastify.get<{ Querystring: SessaoQuery }>('/tarefas', async (request, reply) => {
      try {
        const session = await service.resolverSessao(configStore.get().sessao, { pjeSessionId: request.query.pjeSessionId });
        ok(reply, await listarNomesTarefasDoPainel(session));
      } catch (err) {
        return handleServiceError(err, request, reply);
      }
    });

    fastify.post<{ Body: ExecutarEtiquetasDTO }>('/executar', async (request, reply) => {
      const dto = request.body ?? {};
      try {
        if (dto.credentials && !(dto.credentials.cpf && dto.credentials.password)) {
          throw new AppError('MISSING_CREDENTIALS', 'credentials exige cpf e password.', 400);
        }
        const execucaoId = service.iniciar('manual', dto);
        request.log.info(`[ETIQUETAS] Execução manual ${execucaoId.slice(0, 8)} iniciada por ${getUser(request)?.name ?? '?'}${dto.dryRun ? ' (dry-run)' : ''}`);
        ok(reply, { execucaoId, message: dto.dryRun ? 'Simulação iniciada.' : 'Execução iniciada.' }, 202);
      } catch (err) {
        return handleServiceError(err, request, reply);
      }
    });

    fastify.get('/execucoes', async (_request, reply) => {
      ok(reply, execucoesStore.listar());
    });

    fastify.get<{ Params: { id: string } }>('/execucoes/:id', async (request, reply) => {
      const exec = execucoesStore.get(request.params.id);
      if (!exec) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Execução não encontrada.', statusCode: 404 } });
      }
      ok(reply, exec);
    });

    fastify.delete<{ Params: { id: string } }>('/execucoes/:id', async (request, reply) => {
      const cancelada = service.cancelar(request.params.id);
      if (!cancelada) {
        return reply.status(409).send({ success: false, error: { code: 'NAO_EM_EXECUCAO', message: 'Esta execução não está em andamento.', statusCode: 409 } });
      }
      ok(reply, { message: 'Cancelamento solicitado.' });
    });
  };
}
