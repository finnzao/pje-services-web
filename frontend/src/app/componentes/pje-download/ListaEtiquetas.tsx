'use client';

import React, { useMemo } from 'react';
import { Tag, Star } from 'lucide-react';
import { CampoBusca } from './CampoBusca';
import type { EtiquetaPJE } from './types';
import { safeStr } from './types';

interface ListaEtiquetasProps {
  etiquetas: EtiquetaPJE[];
  selecionada: number | null;
  onSelecionar: (id: number) => void;
}

export function ListaEtiquetas({ etiquetas, selecionada, onSelecionar }: ListaEtiquetasProps) {
  const [busca, setBusca] = React.useState('');

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
    <div>
      <div className="mb-3">
        <CampoBusca valor={busca} onChange={setBusca} placeholder="Buscar etiqueta…" />
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-7 text-center">
          <Tag size={22} className="mx-auto mb-2 text-slate-300" />
          <p className="text-xs text-slate-400">{busca ? 'Nenhuma encontrada.' : 'Nenhuma etiqueta disponível.'}</p>
        </div>
      ) : (
        <div className="scroll-area max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {filtradas.map((etq, idx) => {
            const on = selecionada === etq.id;
            return (
              <button
                key={`tag-${etq.id}-${idx}`}
                type="button"
                onClick={() => onSelecionar(etq.id)}
                className={`row flex items-center gap-2.5 px-3.5 py-3 ${on ? 'row-on' : ''}`}
              >
                <Tag size={13} className={on ? 'text-navy-700' : etq.favorita ? 'text-brass-400' : 'text-slate-400'} />
                <span className={`flex-1 truncate text-sm ${on ? 'font-semibold text-ink' : 'text-slate-700'}`}>
                  {safeStr(etq.nomeTagCompleto) || safeStr(etq.nomeTag) || '(sem nome)'}
                </span>
                {etq.favorita && <Star size={11} className="flex-shrink-0 fill-brass-400 text-brass-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
