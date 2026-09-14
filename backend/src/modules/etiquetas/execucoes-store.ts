import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExecucaoEtiquetas, ExecucaoResumo } from './types';

/**
 * Histórico das execuções (agendadas e manuais) em disco. Mantém as N mais recentes,
 * cada uma com a lista completa de processos afetados (o teto natural é
 * limitePorExecucao da configuração — não há corte adicional aqui, para a planilha
 * de download refletir todos os processos etiquetados).
 */
const HISTORICO_FILE = process.env.ETIQUETAS_HISTORICO_FILE
  || path.join(process.cwd(), '.etiquetas-execucoes.json');
const MAX_EXECUCOES = 30;

class ExecucoesStore {
  private execucoes = new Map<string, ExecucaoEtiquetas>();
  private carregado = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  upsert(exec: ExecucaoEtiquetas): void {
    this.carregarSeNecessario();
    this.execucoes.set(exec.id, exec);
    this.podar();
    this.agendarPersistencia();
  }

  get(id: string): ExecucaoEtiquetas | null {
    this.carregarSeNecessario();
    return this.execucoes.get(id) ?? null;
  }

  /** Mais recentes primeiro, sem a lista de processos. */
  listar(limite = MAX_EXECUCOES): ExecucaoResumo[] {
    this.carregarSeNecessario();
    return [...this.execucoes.values()]
      .sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm))
      .slice(0, limite)
      .map(({ processos: _p, ...resumo }) => resumo);
  }

  ultima(origem?: ExecucaoEtiquetas['origem']): ExecucaoResumo | null {
    return this.listar().find((e) => !origem || e.origem === origem) ?? null;
  }

  private podar(): void {
    if (this.execucoes.size <= MAX_EXECUCOES) return;
    const ordenadas = [...this.execucoes.values()].sort((a, b) => a.iniciadoEm.localeCompare(b.iniciadoEm));
    for (const antiga of ordenadas.slice(0, this.execucoes.size - MAX_EXECUCOES)) {
      if (antiga.status !== 'running') this.execucoes.delete(antiga.id);
    }
  }

  private carregarSeNecessario(): void {
    if (this.carregado) return;
    this.carregado = true;
    try {
      if (!fs.existsSync(HISTORICO_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(HISTORICO_FILE, 'utf8'));
      if (!Array.isArray(raw)) return;
      for (const e of raw as ExecucaoEtiquetas[]) {
        if (!e?.id) continue;
        // Execução interrompida por restart do processo nunca vai concluir: marca como falha.
        if (e.status === 'running') {
          e.status = 'failed';
          e.erro = 'Interrompida por reinício do serviço.';
          e.finalizadoEm = e.finalizadoEm ?? new Date().toISOString();
        }
        this.execucoes.set(e.id, e);
      }
    } catch (err) {
      console.error('[ETIQUETAS] Falha ao ler histórico de execuções:', err instanceof Error ? err.message : err);
    }
  }

  private agendarPersistencia(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        fs.writeFileSync(HISTORICO_FILE, JSON.stringify([...this.execucoes.values()]), 'utf8');
      } catch (err) {
        console.error('[ETIQUETAS] Falha ao persistir histórico:', err instanceof Error ? err.message : err);
      }
    }, 500);
  }
}

export const execucoesStore = new ExecucoesStore();
