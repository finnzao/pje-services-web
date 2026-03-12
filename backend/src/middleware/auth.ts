import type { FastifyRequest, FastifyReply } from 'fastify';

export interface AuthenticatedUser { id: number; name: string; role: string; }

const DEV_USER: AuthenticatedUser = { id: 1, name: 'Dev User', role: 'magistrado' };

interface AuthOptions { requiredRole?: string; skipPaths?: string[]; }

export function authMiddleware(options: AuthOptions = {}) {
  const { requiredRole = 'magistrado', skipPaths = [] } = options;
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (skipPaths.some((p) => request.url.includes(p))) return;
    const userHeader = request.headers['x-user'] as string;
    if (userHeader) {
      let user: AuthenticatedUser;
      try { user = JSON.parse(userHeader); } catch {
        return reply.status(401).send({ success: false, error: { code: 'INVALID_AUTH', message: 'Header x-user inválido.', statusCode: 401 } });
      }
      if (!user.id || !user.name || !user.role)
        return reply.status(401).send({ success: false, error: { code: 'INVALID_AUTH', message: 'Header x-user incompleto.', statusCode: 401 } });
      if (requiredRole && user.role !== requiredRole)
        return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: `Acesso restrito a ${requiredRole}s.`, statusCode: 403 } });
      (request as any).user = user;
      return;
    }
    if (process.env.NODE_ENV !== 'production') {
      (request as any).user = DEV_USER;
      request.log.warn('Header x-user ausente — usando usuário padrão (dev mode)');
      return;
    }
    return reply.status(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Header x-user não encontrado.', statusCode: 401 } });
  };
}

export function getUser(request: FastifyRequest): AuthenticatedUser { return (request as any).user; }
