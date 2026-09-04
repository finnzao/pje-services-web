import type { PjeSession } from '../../../../shared/pje-api-client';
import { PJEAuthProxy } from './pje-auth-proxy';
import { sessionStore } from './session-store';

export interface SessionDto {
  pjeSessionId?: string;
  credentials?: { cpf: string; password: string };
  pjeProfileIndex?: number;
}

/**
 * Resolve a sessão PJE de um job: prioriza a sessão ativa (pjeSessionId — é o
 * que permite gerar planilhas após F5, sem senha em memória) e cai para login
 * com credenciais + seleção de perfil. Extraído do serviço de advogados para
 * ser compartilhado pelos jobs de planilha.
 */
export async function resolveSessionFromDto(dto: SessionDto): Promise<PjeSession> {
  if (dto.pjeSessionId) {
    const existing = sessionStore.get(dto.pjeSessionId);
    if (existing) return existing as unknown as PjeSession;
  }
  if (!dto.credentials?.cpf || !dto.credentials?.password) {
    throw new Error('Sessão PJE expirada. Faça login novamente.');
  }
  const proxy = new PJEAuthProxy();
  const loginResult = await proxy.login(dto.credentials.cpf, dto.credentials.password);
  if (loginResult.error || !loginResult.sessionId) {
    throw new Error(loginResult.error || 'Falha na autenticacao');
  }
  if (dto.pjeProfileIndex !== undefined) {
    await proxy.selectProfile(loginResult.sessionId, dto.pjeProfileIndex);
  }
  const stored = sessionStore.get(loginResult.sessionId);
  if (!stored) throw new Error('Sessao nao encontrada apos login');
  return stored as unknown as PjeSession;
}
