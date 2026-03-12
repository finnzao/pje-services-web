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
      safeStr(e.nomeTagCompleto).toLowerCase().includes(t)
    );
  }, [etiquetas, busca]);

  return (
    <div>
      <div className="mb-3">
        <CampoBusca valor={busca} onChange={setBusca} placeholder="Buscar etiqueta..." />
      </div>

      {filtradas.length === 0 ? (
        <div className="p-6 text-center border-2 border-dashed border-slate-200">
          <Tag size={20} className="text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-400">{busca ? 'Nenhuma encontrada.' : 'Nenhuma etiqueta disponível.'}</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {filtradas.map((etq, idx) => (
            <button key={`tag-${etq.id}-${idx}`} type="button" onClick={() => onSelecionar(etq.id)}
              className={`w-full text-left p-3 border-2 transition-all flex items-center gap-2 ${
                selecionada === etq.id ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300 bg-white'
              }`}>
              <Tag size={12} className={etq.favorita ? 'text-amber-500' : 'text-slate-400'} />
              <span className={`text-sm block truncate flex-1 ${
                selecionada === etq.id ? 'font-bold text-slate-900' : 'text-slate-700'
              }`}>
                {safeStr(etq.nomeTagCompleto) || safeStr(etq.nomeTag) || '(sem nome)'}
              </span>
              {etq.favorita && <Star size={10} className="text-amber-400 flex-shrink-0" fill="currentColor" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
