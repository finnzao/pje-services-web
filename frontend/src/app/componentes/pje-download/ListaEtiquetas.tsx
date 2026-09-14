'use client';

import React, { useMemo } from 'react';
import { Tag, Star, Circle, CircleDot, CheckSquare, Square } from 'lucide-react';
import { CampoBusca } from './CampoBusca';
import type { EtiquetaPJE } from './types';
import { safeStr } from './types';

interface ListaEtiquetasProps {
  etiquetas: EtiquetaPJE[];
  selecionadas: number[];
  onToggle: (id: number) => void;
  /** 'multipla' (padrão): várias etiquetas; 'unica': uma só, com indicador de rádio. */
  modo?: 'multipla' | 'unica';
}

export function ListaEtiquetas({ etiquetas, selecionadas, onToggle, modo = 'multipla' }: ListaEtiquetasProps) {
  const [busca, setBusca] = React.useState('');
  const unica = modo === 'unica';

  const filtradas = useMemo(() => {
    const validas = etiquetas.filter((e) => e != null);
    if (!busca.trim()) return validas;
    const t = busca.toLowerCase();
    return validas.filter((e) =>
      safeStr(e.nomeTag).toLowerCase().includes(t) ||
      safeStr(e.nomeTagCompleto).toLowerCase().includes(t),
    );
  }, [etiquetas, busca]);

  return (
    <div role={unica ? 'radiogroup' : 'group'} aria-label={unica ? 'Escolha uma etiqueta' : 'Etiquetas'}>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1">
          <CampoBusca valor={busca} onChange={setBusca} placeholder="Buscar etiqueta…" />
        </div>
        <span className="chip shrink-0 bg-slate-100 text-slate-600">
          {unica ? 'escolha uma' : `${selecionadas.length} selecionada(s)`}
        </span>
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-7 text-center">
          <Tag size={22} className="mx-auto mb-2 text-slate-300" aria-hidden />
          <p className="text-xs text-slate-500">{busca ? 'Nenhuma encontrada.' : 'Nenhuma etiqueta disponível.'}</p>
        </div>
      ) : (
        <div className="scroll-area max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {filtradas.map((etq, idx) => {
            const on = selecionadas.includes(etq.id);
            const Marcador = unica ? (on ? CircleDot : Circle) : (on ? CheckSquare : Square);
            return (
              <button
                key={`tag-${etq.id}-${idx}`}
                type="button"
                role={unica ? 'radio' : undefined}
                aria-checked={unica ? on : undefined}
                aria-pressed={unica ? undefined : on}
                onClick={() => onToggle(etq.id)}
                className={`row flex items-center gap-2.5 px-3.5 py-3 ${on ? 'row-on' : ''}`}
              >
                <Marcador size={15} className={`shrink-0 ${on ? 'text-navy-700' : 'text-slate-400'}`} aria-hidden />
                <Tag size={13} className={`shrink-0 ${on ? 'text-navy-700' : etq.favorita ? 'text-brass-400' : 'text-slate-500'}`} aria-hidden />
                <span className={`flex-1 truncate text-sm ${on ? 'font-semibold text-ink' : 'text-slate-700'}`}>
                  {safeStr(etq.nomeTagCompleto) || safeStr(etq.nomeTag) || '(sem nome)'}
                </span>
                {etq.favorita && <Star size={11} className="flex-shrink-0 fill-brass-400 text-brass-400" aria-label="favorita" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
