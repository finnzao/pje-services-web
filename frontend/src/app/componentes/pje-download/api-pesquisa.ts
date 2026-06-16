import { request } from '../../lib/api-client';
import type { SearchFormOptions } from './types';

export async function obterOpcoesPesquisa(sessionId: string): Promise<SearchFormOptions> {
  return request<SearchFormOptions>(
    `/api/pje/downloads/search-form-options?sessionId=${encodeURIComponent(sessionId)}`,
  );
}
