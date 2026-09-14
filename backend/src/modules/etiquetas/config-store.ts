import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EtiquetasConfig } from './types';
import { CONFIG_PADRAO, validarConfig } from './etiquetas-core';

/**
 * Persistência da configuração em arquivo JSON, no mesmo padrão de .pje-sessions.json
 * (instância única; trocar por banco/Redis se escalar horizontalmente).
 * Caminho sobrescrevível por ETIQUETAS_CONFIG_FILE (útil em testes e no Docker).
 */
const CONFIG_FILE = process.env.ETIQUETAS_CONFIG_FILE
  || path.join(process.cwd(), '.etiquetas-config.json');

class ConfigStore {
  private config: EtiquetasConfig = { ...CONFIG_PADRAO };
  private carregado = false;

  get(): EtiquetasConfig {
    this.carregarSeNecessario();
    return {
      ...this.config,
      sessao: { ...this.config.sessao },
      tarefasIgnoradas: [...this.config.tarefasIgnoradas],
      etiqueta: this.config.etiqueta ? { ...this.config.etiqueta } : null,
    };
  }

  /** Aplica um patch validado. Lança AppError-compatível (Error com `erros`) se inválido. */
  atualizar(patch: unknown, atualizadoPor?: string): { config?: EtiquetasConfig; erros: string[] } {
    this.carregarSeNecessario();
    const resultado = validarConfig(patch, this.config);
    if (!resultado.config) return resultado;
    this.config = { ...resultado.config, atualizadoEm: new Date().toISOString(), atualizadoPor };
    this.persistir();
    return { config: this.get(), erros: [] };
  }

  /** Uso interno (ex.: limpar sessão vinculada que expirou). Não passa pela validação de "ativo". */
  patchInterno(patch: Partial<EtiquetasConfig>): void {
    this.carregarSeNecessario();
    this.config = { ...this.config, ...patch };
    this.persistir();
  }

  private carregarSeNecessario(): void {
    if (this.carregado) return;
    this.carregado = true;
    try {
      if (!fs.existsSync(CONFIG_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      // Revalida contra o padrão: arquivo editado à mão ou de versão antiga não derruba o serviço.
      const { config, erros } = validarConfig(raw, CONFIG_PADRAO);
      if (config) {
        this.config = { ...config, atualizadoEm: raw?.atualizadoEm ?? config.atualizadoEm, atualizadoPor: raw?.atualizadoPor };
        console.log(`[ETIQUETAS] Configuração restaurada de ${path.basename(CONFIG_FILE)}`);
      } else {
        console.error(`[ETIQUETAS] Configuração em disco inválida, usando padrão: ${erros.join(' ')}`);
      }
    } catch (err) {
      console.error('[ETIQUETAS] Falha ao ler configuração:', err instanceof Error ? err.message : err);
    }
  }

  private persistir(): void {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (err) {
      console.error('[ETIQUETAS] Falha ao persistir configuração:', err instanceof Error ? err.message : err);
    }
  }
}

export const configStore = new ConfigStore();
