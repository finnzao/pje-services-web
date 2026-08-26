import { API_BASE, ApiError, request } from '../../lib/api-client';

export { API_BASE, ApiError };

interface UserDTO {
  idUsuario: number; nomeUsuario: string; login: string;
  perfil: string; nomePerfil: string;
  idUsuarioLocalizacaoMagistradoServidor: number;
}
interface ProfileDTO { indice: number; nome: string; orgao: string; favorito: boolean; }

export async function loginPJE(params: { cpf: string; password: string }) {
  return request<{
    needs2FA: boolean;
    sessionId?: string;
    user?: UserDTO;
    profiles?: ProfileDTO[];

    twoFactorType?: 'totp' | 'email';
  }>('/api/pje/downloads/auth/login', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function enviar2FA(sessionId: string, code: string) {
  return request<{
    needs2FA: boolean;
    sessionId?: string;
    user?: UserDTO;
    profiles?: ProfileDTO[];

    error?: string;
  }>('/api/pje/downloads/auth/2fa', {
    method: 'POST',
    body: JSON.stringify({ sessionId, code }),
  });
}

export async function validarSessao(sessionId: string) {
  return request<{ valid: boolean; reason?: 'NOT_FOUND' | 'EXPIRED' }>(
    `/api/pje/downloads/auth/validate-session?sessionId=${encodeURIComponent(sessionId)}`,
  );
}

export async function selecionarPerfil(sessionId: string, profileIndex: number) {
  return request<{
    tasks: Array<{ id: number; nome: string; quantidadePendente: number }>;
    favoriteTasks: Array<{ id: number; nome: string; quantidadePendente: number }>;
    tags: Array<{ id: number; nomeTag: string; nomeTagCompleto: string; favorita: boolean }>;
  }>('/api/pje/downloads/auth/profile', {
    method: 'POST',
    body: JSON.stringify({ sessionId, profileIndex }),
  });
}

