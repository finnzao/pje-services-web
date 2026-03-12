import type { FastifyInstance } from 'fastify';
import type { GerarPlanilhaAdvogadosDTO } from '../../../../shared/types';
import { PjeAdvogadosService } from '../services/pje-advogados/index';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { authMiddleware, getUser } from '../../../middleware/auth';
import { ok } from '../../../shared/response';

export function advogadosRoutes(service: PjeAdvogadosService) {
  return async function (fastify: FastifyInstance) {
    fastify.addHook('preHandler', authMiddleware({ requiredRole: 'magistrado' }));

    fastify.post<{ Body: GerarPlanilhaAdvogadosDTO }>('/gerar', async (request, reply) => {
      const user = getUser(request);
      const dto = request.body;
      if (!dto?.credentials?.cpf || !dto?.credentials?.password)
        return reply.status(400).send({ success: false, error: { code: 'MISSING_CREDENTIALS', message: 'CPF e senha são obrigatórios.', statusCode: 400 } });
      if (!dto.fonte || !['by_task', 'by_tag'].includes(dto.fonte))
        return reply.status(400).send({ success: false, error: { code: 'INVALID_FONTE', message: 'Fonte deve ser by_task ou by_tag.', statusCode: 400 } });
      if (dto.fonte === 'by_task' && !dto.taskName?.trim())
        return reply.status(400).send({ success: false, error: { code: 'MISSING_TASK', message: 'Nome da tarefa é obrigatório.', statusCode: 400 } });
      if (dto.fonte === 'by_tag' && !dto.tagId)
        return reply.status(400).send({ success: false, error: { code: 'MISSING_TAG', message: 'ID da etiqueta é obrigatório.', statusCode: 400 } });

      const jobId = randomUUID();
      service.gerar(jobId, user.id, dto).catch((err) => { request.log.error({ err }, `[ADVOGADOS] Erro no job ${jobId.slice(0, 8)}`); });
      ok(reply, { jobId, message: 'Geração de planilha iniciada.' }, 202);
    });

    fastify.get<{ Params: { jobId: string } }>('/:jobId/progress', async (request, reply) => {
      const progress = service.getProgress(request.params.jobId);
      ok(reply, progress ?? { status: 'pending', progress: 0, message: 'Aguardando...' });
    });

    fastify.delete<{ Params: { jobId: string } }>('/:jobId', async (request, reply) => {
      service.cancel(request.params.jobId);
      ok(reply, { message: 'Cancelado.' });
    });

    fastify.get<{ Params: { jobId: string } }>('/:jobId/download', async (request, reply) => {
      const progress = service.getProgress(request.params.jobId);
      if (!progress || progress.status !== 'completed')
        return reply.status(404).send({ success: false, error: { code: 'NOT_READY', message: 'Planilha ainda não está pronta.', statusCode: 404 } });
      const downloadsDir = path.join(process.cwd(), 'downloads', 'planilhas');
      if (!fs.existsSync(downloadsDir))
        return reply.status(404).send({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'Diretório não encontrado.', statusCode: 404 } });
      const filesList = fs.readdirSync(downloadsDir).filter((f) => f.endsWith('.xlsx') || f.endsWith('.csv'));
      const sorted = filesList.sort((a, b) => fs.statSync(path.join(downloadsDir, b)).mtimeMs - fs.statSync(path.join(downloadsDir, a)).mtimeMs);
      if (sorted.length === 0)
        return reply.status(404).send({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'Arquivo não encontrado.', statusCode: 404 } });
      const fileName = sorted[0];
      const filePath = path.join(downloadsDir, fileName);
      const contentType = fileName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8';
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      return reply.send(fs.createReadStream(filePath));
    });
  };
}
