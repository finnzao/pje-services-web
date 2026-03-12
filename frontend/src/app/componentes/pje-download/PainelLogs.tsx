'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Terminal, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import type { EntradaLog } from './types';

interface Props {
  logs: EntradaLog[];
  onLimpar: () => void;
}

const NIVEL_CORES: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  success: 'text-emerald-400',
};

export function PainelLogs({ logs, onLimpar }: Props) {
  const [aberto, setAberto] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (aberto && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [logs, aberto]);

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="bg-slate-900 border-t-2 border-slate-700">
      <div role="button" tabIndex={0} onClick={() => setAberto(!aberto)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setAberto(!aberto); }}
        className="w-full px-4 py-2 flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none">
        <div className="flex items-center gap-2">
          <Terminal size={12} />
          <span className="font-mono font-bold">LOGS</span>
          {logs.length > 0 && <span className="px-1.5 py-0.5 bg-slate-800 text-slate-500 text-[10px] font-mono">{logs.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          {aberto && <button type="button" onClick={(e) => { e.stopPropagation(); onLimpar(); }} className="p-1 hover:text-red-400"><Trash2 size={10} /></button>}
          {aberto ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </div>
      </div>
      {aberto && (
        <div ref={scrollRef} className="max-h-48 overflow-y-auto px-4 pb-3 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? <p className="text-slate-600">Nenhum log ainda.</p> : logs.map((log) => (
            <div key={log.id} className="flex gap-2 py-0.5">
              <span className="text-slate-600 flex-shrink-0">{log.timestamp}</span>
              <span className={`flex-shrink-0 font-bold ${NIVEL_CORES[log.nivel] || 'text-slate-400'}`}>[{log.nivel.toUpperCase()}]</span>
              <span className="text-slate-500 flex-shrink-0">[{log.modulo}]</span>
              <span className="text-slate-300">{log.mensagem}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
