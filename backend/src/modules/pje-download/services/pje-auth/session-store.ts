import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StoredSession, PersistedSession } from './types';
import { CPF_SESSION_TTL, SESSION_STORE_TTL } from './constants';
import { validatePjeSession } from '../../../../shared/pje-api-client';

// Persistência em disco: sessões (cookies do PJE) sobrevivem a restart do backend.
// Arquivo local em vez de Redis — instância única. ponytail: trocar por Redis se escalar horizontalmente.
const PERSIST_FILE = path.join(process.cwd(), '.pje-sessions.json');

// Sessões persistidas por CPF (sobrevivem entre requests)
const cpfSessions = new Map<string, PersistedSession>();

export function getPersistedSession(cpf: string): PersistedSession | null {
  const entry = cpfSessions.get(cpf);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > CPF_SESSION_TTL) {
    cpfSessions.delete(cpf);
    schedulePersist();
    return null;
  }
  return entry;
}

export function savePersistedSession(cpf: string, data: Omit<PersistedSession, 'updatedAt'>): void {
  cpfSessions.set(cpf, { ...data, updatedAt: Date.now() });
  schedulePersist();
}

export function clearPersistedSession(cpf: string): void {
  cpfSessions.delete(cpf);
  schedulePersist();
}

// Store para sessões ativas (2FA, seleção de perfil, downloads)
class SessionStore {
  private store = new Map<string, StoredSession>();

  constructor() {
    setInterval(() => { void this.maintain(); }, 5 * 60 * 1000);
  }

  set(id: string, data: StoredSession): void {
    this.store.set(id, { ...data, createdAt: Date.now() });
    schedulePersist();
  }

  get(id: string): StoredSession | undefined {
    const s = this.store.get(id);
    if (!s) return undefined;
    if (Date.now() - (s.createdAt || 0) > SESSION_STORE_TTL) {
      this.store.delete(id);
      schedulePersist();
      return undefined;
    }
    // TTL deslizante: uso ativo renova a janela.
    s.createdAt = Date.now();
    return s;
  }

  delete(id: string): void {
    this.store.delete(id);
    schedulePersist();
  }

  // Sem ssoHtml (página de login inteira): só o necessário para reusar a sessão.
  snapshot(): Record<string, StoredSession> {
    const out: Record<string, StoredSession> = {};
    for (const [id, s] of this.store) {
      const { ssoHtml: _ssoHtml, ...rest } = s;
      out[id] = rest;
    }
    return out;
  }

  restore(entries: Record<string, StoredSession>): void {
    for (const [id, s] of Object.entries(entries)) this.store.set(id, s);
  }

  // Remove expiradas e mantém as vivas aquecidas no PJE (evita expiração por
  // inatividade do lado do tribunal durante operações longas ou telas paradas).
  private async maintain(): Promise<void> {
    const now = Date.now();
    for (const [id, s] of this.store) {
      if (now - (s.createdAt || 0) > SESSION_STORE_TTL) {
        this.store.delete(id);
        schedulePersist();
        continue;
      }
      if (s.idUsuarioLocalizacao) {
        const ok = await validatePjeSession(s as any).catch(() => false);
        if (!ok) { this.store.delete(id); schedulePersist(); }
      }
    }
  }
}

export const sessionStore = new SessionStore();

export function generateSessionId(): string {
  return `pje_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// --- Persistência em disco (debounced) ---

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const data = {
        sessions: sessionStore.snapshot(),
        cpfSessions: Object.fromEntries(cpfSessions),
      };
      fs.writeFileSync(PERSIST_FILE, JSON.stringify(data), 'utf8');
    } catch (err) {
      console.error('[SESSION-STORE] Falha ao persistir sessões:', err instanceof Error ? err.message : err);
    }
  }, 500);
}

function loadFromDisk(): void {
  try {
    if (!fs.existsSync(PERSIST_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf8'));
    const now = Date.now();
    if (raw?.sessions) {
      const vivas: Record<string, StoredSession> = {};
      for (const [id, s] of Object.entries(raw.sessions as Record<string, StoredSession>)) {
        if (now - (s.createdAt || 0) <= SESSION_STORE_TTL) vivas[id] = s;
      }
      sessionStore.restore(vivas);
    }
    if (raw?.cpfSessions) {
      for (const [cpf, s] of Object.entries(raw.cpfSessions as Record<string, PersistedSession>)) {
        if (now - (s.updatedAt || 0) <= CPF_SESSION_TTL) cpfSessions.set(cpf, s);
      }
    }
    const total = Object.keys(raw?.sessions || {}).length + Object.keys(raw?.cpfSessions || {}).length;
    if (total > 0) console.log(`[SESSION-STORE] Sessões restauradas do disco (${total} entrada(s) no arquivo)`);
  } catch (err) {
    console.error('[SESSION-STORE] Falha ao restaurar sessões:', err instanceof Error ? err.message : err);
  }
}

loadFromDisk();
