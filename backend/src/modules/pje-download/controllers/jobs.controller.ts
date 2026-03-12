import type { FastifyInstance } from 'fastify';
import type { CreateDownloadJobDTO, Submit2FADTO } from '../../../shared/types';
import { PJEDownloadService } from '../pje-download.service';
import { authMiddleware, getUser } from '../../../middleware/auth';
import { ok, handleServiceError } from '../../../shared/response';

export function jobsRoutes(service: PJEDownloadService) {
  return async function (fastify: FastifyInstance) {
    fastify.addHook('preHandler', authMiddleware({ requiredRole: 'magistrado' }));
    fastify.post<{ Body: CreateDownloadJobDTO }>('/', async (request, reply) => {
      const user = getUser(request);
      try { ok(reply, await service.createJob(user.id, user.name, request.body), 201); }
      catch (err) { handleServiceError(err, request, reply); }
    });
    fastify.get<{ Querystring: { limit?: string; offset?: string } }>('/', async (request, reply) => {
      const user = getUser(request); const limit = parseInt(request.query.limit || '20', 10); const offset = parseInt(request.query.offset || '0', 10);
      try { ok(reply, await service.listJobs(user.id, limit, offset)); } catch (err) { handleServiceError(err, request, reply); }
    });
    fastify.get<{ Params: { jobId: string } }>('/:jobId', async (request, reply) => {
      const user = getUser(request);
      try { ok(reply, await service.getJob(request.params.jobId, user.id)); } catch (err) { handleServiceError(err, request, reply); }
    });
    fastify.get<{ Params: { jobId: string } }>('/:jobId/progress', async (request, reply) => {
      const user = getUser(request);
      try { await service.getJob(request.params.jobId, user.id); const progress = await service.getProgress(request.params.jobId); ok(reply, progress ?? { status: 'pending', progress: 0, message: 'Aguardando...' }); }
      catch (err) { handleServiceError(err, request, reply); }
    });
    fastify.post<{ Params: { jobId: string }; Body: Submit2FADTO }>('/:jobId/2fa', async (request, reply) => {
      const user = getUser(request);
      try { await service.submit2FA(request.params.jobId, user.id, request.body); ok(reply, { message: 'Codigo 2FA recebido.' }); }
      catch (err) { handleServiceError(err, request, reply); }
    });
    fastify.delete<{ Params: { jobId: string } }>('/:jobId', async (request, reply) => {
      const user = getUser(request);
      try { await service.cancelJob(request.params.jobId, user.id); ok(reply, { message: 'Job cancelado.' }); }
      catch (err) { handleServiceError(err, request, reply); }
    });
    fastify.get<{ Params: { jobId: string } }>('/:jobId/files', async (request, reply) => {
      const user = getUser(request);
      try { ok(reply, await service.getFiles(request.params.jobId, user.id)); } catch (err) { handleServiceError(err, request, reply); }
    });
    fastify.get<{ Params: { jobId: string } }>('/:jobId/audit', async (request, reply) => {
      const user = getUser(request);
      try { ok(reply, await service.getAudit(request.params.jobId, user.id)); } catch (err) { handleServiceError(err, request, reply); }
    });
  };
}
