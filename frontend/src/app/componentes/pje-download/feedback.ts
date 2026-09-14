'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Sinais de andamento/conclusão fora do fluxo de rolagem: título da aba,
 * notificação do navegador e rolagem até o bloco de progresso. Compartilhado
 * pelas telas que executam jobs longos (download, planilhas, etiquetas).
 */

const TITULO_BASE = 'Fórum Hub — PJE/TJBA';

export type StatusExecucaoUi = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export function normalizarStatus(status: string | undefined | null): StatusExecucaoUi {
  if (!status || status === 'idle' || status === 'pending') return 'idle';
  if (status === 'completed' || status === 'done' || status === 'success') return 'completed';
  if (status === 'failed' || status === 'error') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'running';
}

/** Reflete o andamento no título da aba ("⏳ 42% · …", "✓ Concluído · …"). */
export function useTituloAba(status: StatusExecucaoUi, progresso?: number, rotulo?: string): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prefixo = rotulo ? `${rotulo} · ` : '';
    if (status === 'running') {
      const pct = typeof progresso === 'number' ? `${Math.round(progresso)}% ` : '';
      document.title = `⏳ ${pct}${prefixo}${TITULO_BASE}`;
    } else if (status === 'completed') {
      document.title = `✓ Concluído · ${prefixo}${TITULO_BASE}`;
    } else if (status === 'failed') {
      document.title = `✕ Falhou · ${prefixo}${TITULO_BASE}`;
    } else if (status === 'cancelled') {
      document.title = `Cancelado · ${prefixo}${TITULO_BASE}`;
    } else {
      document.title = TITULO_BASE;
    }
    return () => { document.title = TITULO_BASE; };
  }, [status, progresso, rotulo]);
}

/** Notificação nativa (só quando a aba está em segundo plano e há permissão). */
export function notificarNavegador(titulo: string, corpo?: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (document.visibilityState === 'visible') return;
  if (Notification.permission === 'granted') {
    try { new Notification(titulo, { body: corpo }); } catch { /* bloqueado pelo navegador */ }
  }
}

/** Pede permissão de notificação uma vez, no primeiro disparo de job (gesto do usuário). */
export function pedirPermissaoNotificacao(): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => { /* ignorado */ });
  }
}

export function rolarAte(el: HTMLElement | null | undefined, bloco: ScrollLogicalPosition = 'start'): void {
  if (!el) return;
  const reduzMovimento = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduzMovimento ? 'auto' : 'smooth', block: bloco });
}

/**
 * Rola até o elemento quando a execução começa e de novo quando termina —
 * o formulário é longo e o bloco de progresso fica no topo, fora da viewport
 * de quem acabou de clicar no botão do rodapé.
 */
export function useRolarNoProgresso(ref: RefObject<HTMLElement | null>, status: StatusExecucaoUi): void {
  const anterior = useRef<StatusExecucaoUi>('idle');
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = status;
    const comecou = antes === 'idle' && status === 'running';
    const terminou = antes === 'running' && status !== 'running' && status !== 'idle';
    if (comecou || terminou) {
      // Aguarda o render do bloco antes de rolar.
      const t = setTimeout(() => rolarAte(ref.current, 'start'), 50);
      return () => clearTimeout(t);
    }
  }, [status, ref]);
}
