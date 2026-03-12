import type { StoredSession, PersistedSession } from './types';
import { CPF_SESSION_TTL, SESSION_STORE_TTL } from './constants';

// Sessões persistidas por CPF (sobrevivem entre requests)
const cpfSessions = new Map<string, PersistedSession>();

export function getPersistedSession(cpf: string): PersistedSession | null {
  const entry = cpfSessions.get(cpf);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > CPF_SESSION_TTL) {
    cpfSessions.delete(cpf);
    return null;
  }
  return entry;
}

export function savePersistedSession(cpf: string, data: Omit<PersistedSession, 'updatedAt'>): void {
  cpfSessions.set(cpf, { ...data, updatedAt: Date.now() });
}

export function clearPersistedSession(cpf: string): void {
  cpfSessions.delete(cpf);
}

// Store temporário para sessões ativas (2FA, seleção de perfil)
class SessionStore {
  private store = new Map<string, StoredSession>();

  constructor() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  set(id: string, data: StoredSession): void {
    this.store.set(id, { ...data, createdAt: Date.now() });
  }

  get(id: string): StoredSession | undefined {
    const s = this.store.get(id);
    if (!s) return undefined;
    if (Date.now() - (s.createdAt || 0) > SESSION_STORE_TTL) {
      this.store.delete(id);
      return undefined;
    }
    return s;
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, s] of this.store)
      if (now - (s.createdAt || 0) > SESSION_STORE_TTL) this.store.delete(id);
  }
}

export const sessionStore = new SessionStore();

export function generateSessionId(): string {
  return `pje_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
