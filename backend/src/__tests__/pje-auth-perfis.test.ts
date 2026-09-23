import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTML_PERFIS_DEV_SEAM } from './fixtures/perfis-dev-seam';

vi.mock('../modules/pje-download/services/pje-auth/session-store', () => {
  const sessoes = new Map<string, any>();
  const porCpf = new Map<string, any>();
  let seq = 0;
  return {
    sessionStore: {
      get: (id: string) => sessoes.get(id),
      set: (id: string, d: any) => { sessoes.set(id, { ...d }); },
      delete: (id: string) => { sessoes.delete(id); },
    },
    generateSessionId: () => `sid_${++seq}`,
    getPersistedSession: (cpf: string) => porCpf.get(cpf) ?? null,
    savePersistedSession: (cpf: string, d: any) => { porCpf.set(cpf, { ...d, updatedAt: Date.now() }); },
    clearPersistedSession: (cpf: string) => { porCpf.delete(cpf); },
    __porCpf: porCpf,
  };
});

import * as sessionStoreMock from '../modules/pje-download/services/pje-auth/session-store';
import { PJEAuthProxy } from '../modules/pje-download/services/pje-auth/pje-auth-proxy';

const CPF = '00000000000';
const LOCALIZACAO_POR_INDICE: Record<number, number> = { [-1]: 100, 0: 110, 1: 111, 2: 112 };

function criarPje(localizacaoInicial = 100) {
  const html = HTML_PERFIS_DEV_SEAM;
  const estado = { localizacao: localizacaoInicial, gets: 0, posts: 0 };
  const http = {
    followRedirects: vi.fn(async (metodo: string, _url: string, body?: URLSearchParams) => {
      if (metodo === 'GET') estado.gets++;
      if (metodo === 'POST' && body) {
        estado.posts++;
        for (const chave of body.keys()) {
          const m = chave.match(/^papeisUsuarioForm:dtPerfil:(?:(\d+):)?j_id\d+$/);
          if (m) estado.localizacao = LOCALIZACAO_POR_INDICE[m[1] === undefined ? -1 : Number(m[1])];
        }
      }
      return { body: html, finalUrl: 'https://pje.tjba.jus.br/pje/ng2/dev.seam', status: 200 };
    }),
    apiGet: vi.fn(async () => ({
      idUsuario: 1, nomeUsuario: 'Teste', idUsuarioLocalizacaoMagistradoServidor: estado.localizacao,
    })),
    apiPost: vi.fn(async (endpoint: string) => (endpoint === 'painelUsuario/etiquetas' ? { entities: [] } : [])),
  };
  return { estado, http };
}

function proxyCom(http: unknown): PJEAuthProxy {
  const proxy = new PJEAuthProxy();
  (proxy as any).http = http;
  return proxy;
}

function persistirSessao(localizacao: number, profiles?: unknown[]) {
  sessionStoreMock.savePersistedSession(CPF, {
    cookies: { JSESSIONID: 'x' }, idUsuarioLocalizacao: String(localizacao), idUsuario: 1, ...(profiles ? { profiles: profiles as any } : {}),
  });
}

describe('login com perfis em cache', () => {
  beforeEach(() => {
    (sessionStoreMock as any).__porCpf.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('sem cache lista os perfis, guarda na sessão persistida e seleciona sem recarregar a página', async () => {
    persistirSessao(100);
    const { estado, http } = criarPje();

    const login = await proxyCom(http).login(CPF, 'senha');
    expect(login.profiles).toHaveLength(4);
    expect(estado.gets).toBe(1);
    expect(sessionStoreMock.getPersistedSession(CPF)?.profiles).toHaveLength(4);

    const selecao = await proxyCom(http).selectProfile(login.sessionId!, 2);
    expect(selecao.error).toBeUndefined();
    expect(estado.gets).toBe(1);
    expect(sessionStoreMock.sessionStore.get(login.sessionId!)?.idUsuarioLocalizacao).toBe('112');
    expect(sessionStoreMock.getPersistedSession(CPF)?.profiles).toHaveLength(4);
  });

  it('com cache responde na hora e a seleção aguarda a atualização em segundo plano', async () => {
    const { estado, http } = criarPje();
    persistirSessao(100, [
      { indice: -1, nome: 'VARA CRIMINAL DE RIO REAL / Direção de Secretaria / Diretor de Secretaria', orgao: '', favorito: true },
      { indice: 0, nome: 'V DOS FEITOS DE REL DE CONS CIV E COMERCIAIS DE RIO REAL / Assessoria / Assessor', orgao: '', favorito: false },
    ]);

    const login = await proxyCom(http).login(CPF, 'senha');
    expect(login.profiles).toHaveLength(2);

    const selecao = await proxyCom(http).selectProfile(login.sessionId!, 0);
    expect(selecao.error).toBeUndefined();
    expect(estado.gets).toBe(1);
    expect(sessionStoreMock.sessionStore.get(login.sessionId!)?.idUsuarioLocalizacao).toBe('110');
    expect(sessionStoreMock.getPersistedSession(CPF)?.profiles).toHaveLength(4);
  });

  it('se a troca não é confirmada, recarrega a página de perfis e seleciona de novo', async () => {
    persistirSessao(112);
    const { estado, http } = criarPje(112);

    const login = await proxyCom(http).login(CPF, 'senha');
    const selecao = await proxyCom(http).selectProfile(login.sessionId!, 2);

    expect(selecao.error).toBeUndefined();
    expect(estado.gets).toBe(2);
    expect(estado.posts).toBe(2);
  });

  it('recusa a seleção quando o perfil exibido não é mais o mesmo no PJE', async () => {
    persistirSessao(100, [
      { indice: -1, nome: 'VARA CRIMINAL DE RIO REAL / Direção de Secretaria / Diretor de Secretaria', orgao: '', favorito: true },
      { indice: 0, nome: 'Perfil que foi removido', orgao: '', favorito: false },
    ]);
    const { estado, http } = criarPje();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const login = await proxyCom(http).login(CPF, 'senha');
    const selecao = await proxyCom(http).selectProfile(login.sessionId!, 0);

    expect(selecao.error).toMatch(/lista de perfis mudou/);
    expect(estado.posts).toBe(0);
  });
});
