import { sessionStore } from '../pje-download/services/pje-auth';
import { configStore } from './config-store';
import { execucoesStore } from './execucoes-store';
import { deveExecutarAgora, proximaOcorrencia } from './etiquetas-core';
import type { EtiquetasService } from './etiquetas.service';
import type { StatusAgendador } from './types';

const TICK_MS = 60 * 1000;
// Menor que SESSION_STORE_TTL (30 min): o get() renova o TTL deslizante da sessão
// vinculada e a manutenção do sessionStore (5 min) mantém o keep-alive no PJE.
const KEEPALIVE_MS = 4 * 60 * 1000;

/**
 * Worker in-process (sem dependência de cron externo): a cada minuto verifica se a
 * rotina está ativa e se o horário configurado já passou sem execução hoje.
 * Desligável por ETIQUETAS_SCHEDULER=off (ex.: instância secundária ou testes).
 */
export class EtiquetasScheduler {
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly service: EtiquetasService) {}

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.keepAliveTimer = setInterval(() => this.keepAlive(), KEEPALIVE_MS);
    this.tickTimer.unref?.();
    this.keepAliveTimer.unref?.();
    console.log('[ETIQUETAS] Agendador iniciado (verificação a cada 60 s).');
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.tickTimer = null;
    this.keepAliveTimer = null;
  }

  async status(): Promise<StatusAgendador> {
    const config = configStore.get();
    const agora = new Date();
    return {
      ativo: config.ativo && this.tickTimer !== null,
      horaExecucao: config.horaExecucao,
      proximaExecucao: config.ativo && this.tickTimer ? proximaOcorrencia(config.horaExecucao, agora).toISOString() : null,
      emExecucao: this.service.emExecucao,
      execucaoAtualId: this.service.execucaoAtual,
      ultimaExecucao: execucoesStore.ultima(),
      sessaoVinculada: !!(config.sessao.pjeSessionId || config.sessao.cpf),
      sessaoValida: await this.service.sessaoConfiguradaValida(config.sessao),
    };
  }

  private tick(): void {
    try {
      const config = configStore.get();
      if (!config.ativo || !config.etiqueta || this.service.emExecucao) return;
      const ultimaAgendada = execucoesStore.ultima('agendada');
      if (!deveExecutarAgora(config.horaExecucao, new Date(), ultimaAgendada?.iniciadoEm)) return;
      const id = this.service.iniciar('agendada');
      console.log(`[ETIQUETAS] Execução agendada disparada (${id.slice(0, 8)}) — horário ${config.horaExecucao}.`);
    } catch (err) {
      console.error('[ETIQUETAS] Falha ao disparar execução agendada:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Enquanto a rotina estiver ativa, mantém viva a sessão vinculada: sem isso ela
   * expiraria por inatividade (30 min) antes do horário da madrugada.
   */
  private keepAlive(): void {
    const config = configStore.get();
    if (!config.ativo || !config.sessao.pjeSessionId) return;
    const viva = sessionStore.get(config.sessao.pjeSessionId);
    if (!viva) {
      console.warn('[ETIQUETAS] Sessão vinculada expirou; a rotina dependerá do fallback por CPF/ambiente até nova vinculação.');
      configStore.patchInterno({ sessao: { ...config.sessao, pjeSessionId: undefined } });
    }
  }
}
