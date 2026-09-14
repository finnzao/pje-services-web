'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

/**
 * Toasts de conclusão: um emissor global mínimo (sem contexto) + um host fixo no
 * canto inferior direito. Usado quando um job termina e o resultado pode estar
 * fora da viewport.
 */

export type ToastTom = 'sucesso' | 'erro' | 'info';

export interface ToastMsg {
  id: number;
  tom: ToastTom;
  titulo: string;
  descricao?: string;
  acao?: { rotulo: string; onClick: () => void };
  duracaoMs?: number;
}

type Ouvinte = (t: ToastMsg) => void;
const ouvintes = new Set<Ouvinte>();
let seq = 0;

export function notificar(t: Omit<ToastMsg, 'id'>): void {
  const msg: ToastMsg = { id: ++seq, duracaoMs: 8000, ...t };
  for (const o of ouvintes) o(msg);
}

const ICONE: Record<ToastTom, React.ReactNode> = {
  sucesso: <CheckCircle size={18} className="mt-0.5 shrink-0 text-emerald-600" />,
  erro: <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />,
  info: <Info size={18} className="mt-0.5 shrink-0 text-navy-600" />,
};

const BORDA: Record<ToastTom, string> = {
  sucesso: 'border-emerald-200',
  erro: 'border-red-200',
  info: 'border-navy-200',
};

export function ToastHost() {
  const [lista, setLista] = useState<ToastMsg[]>([]);

  useEffect(() => {
    const ouvinte: Ouvinte = (t) => {
      setLista((prev) => [...prev.slice(-3), t]);
      if (t.duracaoMs && t.duracaoMs > 0) {
        setTimeout(() => setLista((prev) => prev.filter((x) => x.id !== t.id)), t.duracaoMs);
      }
    };
    ouvintes.add(ouvinte);
    return () => { ouvintes.delete(ouvinte); };
  }, []);

  if (lista.length === 0) return null;

  return (
    <div className="toast-host" role="region" aria-label="Notificações">
      {lista.map((t) => (
        <div key={t.id} className={`toast ${BORDA[t.tom]}`} role={t.tom === 'erro' ? 'alert' : 'status'}>
          {ICONE[t.tom]}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{t.titulo}</p>
            {t.descricao && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{t.descricao}</p>}
            {t.acao && (
              <button
                type="button"
                onClick={() => { t.acao?.onClick(); setLista((prev) => prev.filter((x) => x.id !== t.id)); }}
                className="mt-2 text-xs font-semibold text-navy-700 underline-offset-2 hover:underline"
              >
                {t.acao.rotulo}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLista((prev) => prev.filter((x) => x.id !== t.id))}
            aria-label="Fechar notificação"
            className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
