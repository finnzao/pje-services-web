import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EtiquetarPorDigitoDTO, GerarPlanilhaDigitoDTO, SalvarConfigDigitoDTO } from '../../../shared/types';
import type { EtiquetagemDigitoService, PlanilhaDigitoService } from '../services/planilha-digito';
import { chaveConfigDigito, digitoConfigStore } from '../services/planilha-digito';
import { sessionStore } from '../services/pje-auth';
import { authMiddleware, getUser } from '../../../middleware/auth';
import { handleServiceError, ok } from '../../../shared/response';

const DOWNLOADS_DIR = path.join(process.cwd(), 'downloads', 'planilhas');

export function planilhaDigitoRoutes(service: PlanilhaDigitoService, etiquetagem: EtiquetagemDigitoService) {
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

      if (dto.etiquetasServidor !== undefined) {
        const lista = Array.isArray(dto.etiquetasServidor) ? dto.etiquetasServidor : null;
        const ok = lista?.every((e) => !!e?.servidor?.trim() && Number.isInteger(e?.etiqueta?.id) && e.etiqueta.id > 0 && !!e?.etiqueta?.nome?.trim());
        if (!ok) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_ETIQUETAS', message: 'etiquetasServidor deve listar servidor e etiqueta (id e nome).', statusCode: 400 },
          });
        }
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

    await etiquetagemDigitoRoutes(etiquetagem)(fastify);
    await configDigitoRoutes()(fastify);
  };
}

// A chave da configuração vem da sessão PJE (CPF + perfil), nunca do cliente.
function resolverChave(pjeSessionId: string | undefined, reply: FastifyReply): string | null {
  if (!pjeSessionId) {
    reply.status(400).send({ success: false, error: { code: 'MISSING_SESSION', message: 'pjeSessionId e obrigatorio.', statusCode: 400 } });
    return null;
  }
  const sessao = sessionStore.get(pjeSessionId);
  if (!sessao?.idUsuarioLocalizacao) {
    reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Sessao PJE expirada.', statusCode: 401 } });
    return null;
  }
  return chaveConfigDigito(sessao);
}

function configDigitoRoutes() {
  return async function (fastify: FastifyInstance) {
    fastify.get<{ Querystring: { pjeSessionId?: string } }>('/config', async (request, reply) => {
      const chave = resolverChave(request.query.pjeSessionId, reply);
      if (!chave) return;
      ok(reply, digitoConfigStore.get(chave));
    });

    fastify.put<{ Body: SalvarConfigDigitoDTO }>('/config', async (request, reply) => {
      const chave = resolverChave(request.body?.pjeSessionId, reply);
      if (!chave) return;
      const { config, erros } = digitoConfigStore.salvar(chave, request.body?.config, getUser(request)?.name);
      if (!config) {
        return reply.status(400).send({
          success: false,
          error: { code: 'CONFIG_INVALIDA', message: erros.join(' '), statusCode: 400, details: erros },
        });
      }
      ok(reply, config);
    });

    fastify.delete<{ Querystring: { pjeSessionId?: string } }>('/config', async (request, reply) => {
      const chave = resolverChave(request.query.pjeSessionId, reply);
      if (!chave) return;
      ok(reply, { removida: digitoConfigStore.remover(chave) });
    });
  };
}

function etiquetagemDigitoRoutes(etiquetagem: EtiquetagemDigitoService) {
  return async function (fastify: FastifyInstance) {
    fastify.post<{ Params: { jobId: string }; Body: EtiquetarPorDigitoDTO }>('/:jobId/etiquetar', async (request, reply) => {
      const dto = request.body ?? {};
      try {
        if (dto.credentials && !(dto.credentials.cpf && dto.credentials.password)) {
          return reply.status(400).send({
            success: false,
            error: { code: 'MISSING_CREDENTIALS', message: 'credentials exige cpf e password.', statusCode: 400 },
          });
        }
        etiquetagem.iniciar(request.params.jobId, dto);
        request.log.info(`[ETIQUETAGEM-DIGITO] Job ${request.params.jobId.slice(0, 8)} iniciado por ${getUser(request)?.name ?? '?'}`);
        ok(reply, { jobId: request.params.jobId, message: 'Etiquetagem iniciada.' }, 202);
      } catch (err) {
        return handleServiceError(err, request, reply);
      }
    });

    fastify.get<{ Params: { jobId: string } }>('/:jobId/etiquetar/progress', async (request, reply) => {
      const progress = etiquetagem.getProgress(request.params.jobId);
      if (!progress) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Nenhuma etiquetagem para este job.', statusCode: 404 },
        });
      }
      ok(reply, progress);
    });

    fastify.delete<{ Params: { jobId: string } }>('/:jobId/etiquetar', async (request, reply) => {
      if (!etiquetagem.cancelar(request.params.jobId)) {
        return reply.status(409).send({
          success: false,
          error: { code: 'NAO_EM_EXECUCAO', message: 'A etiquetagem não está em andamento.', statusCode: 409 },
        });
      }
      ok(reply, { message: 'Cancelamento solicitado.' });
    });
  };
}
