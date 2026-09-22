import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConfigAutomacaoDigito } from '../../../../shared/types';
import { CONFIG_DIGITO_VERSAO, validarConfigDigito } from './digito-config-core';

/**
 * Configurações da automação por dígito, uma por perfil do PJE, em arquivo JSON
 * (mesmo padrão de .etiquetas-config.json). Caminho sobrescrevível por DIGITO_CONFIG_FILE.
 */
const CONFIG_FILE = process.env.DIGITO_CONFIG_FILE || path.join(process.cwd(), '.digito-config.json');
const MAX_PERFIS = 200;
const PERSIST_DELAY_MS = 300;

interface Arquivo { versao: number; perfis: Record<string, ConfigAutomacaoDigito>; }

class DigitoConfigStore {
  private perfis = new Map<string, ConfigAutomacaoDigito>();
  private carregado = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  get(chave: string): ConfigAutomacaoDigito | null {
    this.carregarSeNecessario();
    const c = this.perfis.get(chave);
    return c ? structuredClone(c) : null;
  }

  salvar(chave: string, raw: unknown, atualizadoPor?: string): { config?: ConfigAutomacaoDigito; erros: string[] } {
    this.carregarSeNecessario();
    const { config, erros } = validarConfigDigito(raw);
    if (!config) return { erros };
    const salva: ConfigAutomacaoDigito = { ...config, atualizadoEm: new Date().toISOString(), atualizadoPor };
    this.perfis.set(chave, salva);
    this.podar();
    this.agendarPersistencia();
    return { config: structuredClone(salva), erros: [] };
  }

  remover(chave: string): boolean {
    this.carregarSeNecessario();
    const existia = this.perfis.delete(chave);
    if (existia) this.agendarPersistencia();
    return existia;
  }

  // Perfis que não são salvos há mais tempo saem primeiro.
  private podar(): void {
    if (this.perfis.size <= MAX_PERFIS) return;
    const ordenados = [...this.perfis.entries()].sort((a, b) => a[1].atualizadoEm.localeCompare(b[1].atualizadoEm));
    for (const [chave] of ordenados.slice(0, this.perfis.size - MAX_PERFIS)) this.perfis.delete(chave);
  }

  private carregarSeNecessario(): void {
    if (this.carregado) return;
    this.carregado = true;
    try {
      if (!fs.existsSync(CONFIG_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<Arquivo>;
      const perfis = raw?.perfis && typeof raw.perfis === 'object' ? raw.perfis : {};
      let invalidos = 0;
      for (const [chave, valor] of Object.entries(perfis)) {
        const { config } = validarConfigDigito(valor);
        if (config) this.perfis.set(chave, config);
        else invalidos++;
      }
      console.log(`[DIGITO-CONFIG] ${this.perfis.size} configuração(ões) restaurada(s) de ${path.basename(CONFIG_FILE)}${invalidos ? ` (${invalidos} inválida(s) ignorada(s))` : ''}`);
    } catch (err) {
      console.error('[DIGITO-CONFIG] Falha ao ler configurações:', err instanceof Error ? err.message : err);
    }
  }

  private agendarPersistencia(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistir();
    }, PERSIST_DELAY_MS);
  }

  // Escreve em arquivo temporário e renomeia, para um crash no meio não corromper o JSON.
  private persistir(): void {
    const arquivo: Arquivo = { versao: CONFIG_DIGITO_VERSAO, perfis: Object.fromEntries(this.perfis) };
    const tmp = `${CONFIG_FILE}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(arquivo, null, 2), 'utf8');
      fs.renameSync(tmp, CONFIG_FILE);
    } catch (err) {
      console.error('[DIGITO-CONFIG] Falha ao persistir configurações:', err instanceof Error ? err.message : err);
      try { fs.rmSync(tmp, { force: true }); } catch { /* nada a fazer */ }
    }
  }
}

export const digitoConfigStore = new DigitoConfigStore();
