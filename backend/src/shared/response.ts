import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors';

export function ok<T>(reply: FastifyReply, data: T, statusCode = 200): void {
  reply.status(statusCode).send({ success: true, data, timestamp: new Date().toISOString() });
}

export function handleServiceError(err: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    const sc = err.statusCode;
    if (sc >= 500) request.log.error({ err }, err.message);
    else request.log.warn(`${err.code}: ${err.message}`);
    return reply.status(sc).send({ success: false, error: { code: err.code, message: err.message, statusCode: sc, timestamp: new Date().toISOString() } });
  }
  request.log.error({ err }, 'Erro inesperado');
  return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erro interno.', statusCode: 500, timestamp: new Date().toISOString() } });
}

export { AppError };
