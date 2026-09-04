import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GerarPlanilhaDigitoDTO } from '../../../shared/types';
import type { PlanilhaDigitoService } from '../services/planilha-digito';
import { authMiddleware } from '../../../middleware/auth';
import { ok } from '../../../shared/response';

const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads', 'planilhas');

export function planilhaDigitoRoutes(service: PlanilhaDigitoService) {
  return async function (fastify: FastifyInstance) {
    fastify.addHook('preHandler', authMiddleware({ requiredRole: 'magistrado' }));

    fastify.post<{ Body: GerarPlanilhaDigitoDTO }>('/gerar', async (request, reply) => {
      const dto = request.body;

      const temCredenciais = !!(dto?.credentials?.cpf && dto?.credentials?.password);
      if (!temCredenciais && !dto?.pjeSessionId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_CREDENTIALS', message: 'Informe CPF e senha ou uma sessao PJE ativa.', statusCode: 400 },
        });
      }

      const atribuicoesValidas = Array.isArray(dto.atribuicoes) && dto.atribuicoes.some(
        (a) => Number.isInteger(a?.digito) && a.digito >= 0 && a.digito <= 9 && !!a?.servidor?.trim(),
      );
      if (!atribuicoesValidas) {
        return reply.status(400).send({
          success: false,
          error: { code: 'MISSING_ATRIBUICOES', message: 'Informe ao menos um digito atribuido a um servidor.', statusCode: 400 },
        });
      }

      if (!dto.formato || !['xlsx', 'zip'].includes(dto.formato)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_FORMATO', message: 'Formato deve ser xlsx ou zip.', statusCode: 400 },
        });
      }

      const jobId = randomUUID();
      service.gerar(jobId, dto).catch((err) => {
        request.log.error({ err }, `[PLANILHA-DIGITO] Erro no job ${jobId.slice(0, 8)}`);
      });
      ok(reply, { jobId, message: 'Geracao da planilha por digito iniciada.' }, 202);
    });

    fastify.get<{ Params: { jobId: string } }>('/:jobId/progress', async (request, reply) => {
      const progress = service.getProgress(request.params.jobId);
      ok(reply, progress ?? { status: 'pending', progress: 0, message: 'Aguardando...' });
    });

    fastify.delete<{ Params: { jobId: string } }>('/:jobId', async (request, reply) => {
      service.cancel(request.params.jobId);
      ok(reply, { message: 'Cancelado.' });
    });

    // Resolve o arquivo PELO jobId (o nome carrega o jobId) — não repete o padrão
    // "arquivo mais recente do diretório" da rota de advogados.
    fastify.get<{ Params: { jobId: string } }>('/:jobId/download', async (request, reply) => {
      const progress = service.getProgress(request.params.jobId);
      if (!progress || progress.status !== 'completed' || !progress.fileName) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_READY', message: 'Planilha ainda nao esta pronta.', statusCode: 404 },
        });
      }
      const filePath = path.join(DOWNLOADS_DIR, path.basename(progress.fileName));
      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: 'Arquivo expirado ou removido. Gere novamente.', statusCode: 404 },
        });
      }
      const contentType = filePath.endsWith('.zip')
        ? 'application/zip'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
      return reply.send(fs.createReadStream(filePath));
    });
  };
}
