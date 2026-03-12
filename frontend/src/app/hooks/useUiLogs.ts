'use client';

import { useState, useCallback } from 'react';
import type { EntradaLog } from '../componentes/pje-download/types';
import { logger } from '../componentes/pje-download/types';

let logIdCounter = 0;

export function useUiLogs() {
  const [logs, setLogs] = useState<EntradaLog[]>([]);
  const addLog = useCallback((nivel: EntradaLog['nivel'], modulo: string, mensagem: string, dados?: unknown) => {
    const entry: EntradaLog = {
      id: ++logIdCounter,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      nivel, modulo, mensagem, dados,
    };
    setLogs((prev) => [entry, ...prev].slice(0, 200));
    logger[nivel](modulo, mensagem, dados);
  }, []);
  const limpar = useCallback(() => setLogs([]), []);
  return { logs, addLog, limpar };
}
