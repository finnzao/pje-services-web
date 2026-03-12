import type { FastifyInstance } from 'fastify';
import { PJEAuthProxy } from '../services/auth/pje-auth-proxy.service';
import { ok } from '../../../shared/response';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { cpf: string; password: string } }>('/login', async (request, reply) => {
    const { cpf, password } = request.body || {};
    if (!cpf || !password) return reply.status(400).send({ success: false, error: { code: 'MISSING_CREDENTIALS', message: 'CPF e senha são obrigatórios.', statusCode: 400 } });
    const cpfDigits = cpf.replace(/\D/g, '');
    if (cpfDigits.length !== 11) return reply.status(400).send({ success: false, error: { code: 'INVALID_CPF', message: 'CPF deve ter 11 dígitos.', statusCode: 400 } });
    request.log.info(`[AUTH] Login PJE: CPF ***${cpfDigits.slice(-4)}`);
    const proxy = new PJEAuthProxy();
    const result = await proxy.login(cpfDigits, password);
    if (result.error && !result.needs2FA && !result.user) return reply.status(401).send({ success: false, error: { code: 'AUTH_FAILED', message: result.error, statusCode: 401 } });
    ok(reply, { needs2FA: result.needs2FA, sessionId: result.sessionId, user: result.user, profiles: result.profiles });
  });

  fastify.post<{ Body: { sessionId: string; code: string } }>('/2fa', async (request, reply) => {
    const { sessionId, code } = request.body || {};
    if (!code || !/^\d{6}$/.test(code)) return reply.status(400).send({ success: false, error: { code: 'INVALID_CODE', message: 'Código 2FA deve ter 6 dígitos.', statusCode: 400 } });
    if (!sessionId) return reply.status(400).send({ success: false, error: { code: 'MISSING_SESSION', message: 'sessionId obrigatório.', statusCode: 400 } });
    const proxy = new PJEAuthProxy();
    const result = await proxy.submit2FA(sessionId, code);
    if (result.error && !result.needs2FA && !result.user) return reply.status(401).send({ success: false, error: { code: '2FA_FAILED', message: result.error, statusCode: 401 } });
    ok(reply, { needs2FA: result.needs2FA, sessionId: result.sessionId, user: result.user, profiles: result.profiles });
  });

  fastify.post<{ Body: { sessionId: string; profileIndex: number } }>('/profile', async (request, reply) => {
    const { sessionId, profileIndex } = request.body || {};
    if (profileIndex === undefined || profileIndex === null) return reply.status(400).send({ success: false, error: { code: 'MISSING_PARAMS', message: 'profileIndex obrigatório.', statusCode: 400 } });
    if (!sessionId) return reply.status(400).send({ success: false, error: { code: 'MISSING_SESSION', message: 'sessionId obrigatório.', statusCode: 400 } });
    const proxy = new PJEAuthProxy();
    const result = await proxy.selectProfile(sessionId, profileIndex);
    if (result.error) {
      const isExpired = result.error === 'SESSION_EXPIRED';
      const sc = isExpired ? 401 : 400;
      return reply.status(sc).send({ success: false, error: { code: isExpired ? 'SESSION_EXPIRED' : 'PROFILE_ERROR', message: isExpired ? 'Sessão PJE expirada.' : result.error, statusCode: sc } });
    }
    ok(reply, { tasks: result.tasks, favoriteTasks: result.favoriteTasks, tags: result.tags });
  });

  fastify.get<{ Querystring: { sessionId: string } }>('/profiles', async (request, reply) => {
    const sessionId = (request.query as any).sessionId;
    if (!sessionId) return reply.status(400).send({ success: false, error: { code: 'MISSING_SESSION', message: 'sessionId obrigatório.', statusCode: 400 } });
    const proxy = new PJEAuthProxy();
    const result = await proxy.getAllProfiles(sessionId);
    if (result.error === 'SESSION_EXPIRED') return reply.status(401).send({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Sessão PJE expirada.', statusCode: 401 } });
    ok(reply, { profiles: result.profiles || [] });
  });
}
