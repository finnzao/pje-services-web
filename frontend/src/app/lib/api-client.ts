/**
 * Cliente HTTP centralizado.
 *
 * API_BASE, ApiError e request() ficam SOMENTE aqui.
 * Todos os módulos que precisam fazer chamadas à API importam deste arquivo.
 */

export const API_BASE = '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user': JSON.stringify({ id: 1, name: 'Dr. João Magistrado', role: 'magistrado' }),
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    const res = await fetch(url, { ...options, headers });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const errorMsg = body?.error?.message || body?.message || `HTTP ${res.status}`;
      throw new ApiError(res.status, errorMsg, body);
    }

    return (body?.data ?? body) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof TypeError && err.message === 'Failed to fetch')
      throw new ApiError(0, 'Servidor indisponível. Verifique se a API está em execução.');
    throw err;
  }
}