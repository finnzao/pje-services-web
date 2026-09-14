'use client';

import React from 'react';
import { Loader2, X } from 'lucide-react';

interface BarraStatusFixaProps {
  visivel: boolean;
  mensagem: string;
  progresso: number;
  etapa?: string;
  onCancelar?: () => void;
  onVer?: () => void;
}

/**
 * Barra fixa no rodapé do cartão enquanto há execução ativa: o usuário vê o
 * andamento de qualquer ponto da página, mesmo com o formulário longo acima.
 * Mesma linguagem visual do rodapé fixo do DownloadAction.
 */
export function BarraStatusFixa({ visivel, mensagem, progresso, etapa, onCancelar, onVer }: BarraStatusFixaProps) {
  if (!visivel) return null;
  const pct = Math.max(0, Math.min(100, Math.round(progresso)));
  return (
    <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t border-slate-200 bg-white/90 px-6 py-3 backdrop-blur-md sm:-mx-7 sm:px-7">
      <div className="flex items-center gap-3">
        <Loader2 size={16} className="shrink-0 animate-spin text-navy-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-semibold text-ink">
              {etapa && <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">{etapa}</span>}
              {mensagem}
            </p>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">{pct}%</span>
          </div>
          <div className="progress-track mt-1.5" aria-hidden>
            <div className="progress-bar bg-navy-700" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {onVer && (
          <button type="button" onClick={onVer} className="btn btn-ghost shrink-0 px-3 py-2 text-xs">
            Ver andamento
          </button>
        )}
        {onCancelar && (
          <button type="button" onClick={onCancelar} className="btn btn-danger shrink-0 px-3 py-2 text-xs">
            <X size={13} /> Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
