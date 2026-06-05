'use client';

import React, { useState } from 'react';
import { Search, User, Hash, X, Plus, Info } from 'lucide-react';
import type { FiltroAdvogado } from './types';

interface FiltrosAdvogadosProps {
  filtros: FiltroAdvogado[];
  onChange: (filtros: FiltroAdvogado[]) => void;
}

export function FiltrosAdvogados({ filtros, onChange }: FiltrosAdvogadosProps) {
  const [tipo, setTipo] = useState<'nome' | 'oab'>('nome');
  const [valor, setValor] = useState('');

  const adicionar = () => {
    const v = valor.trim();
    if (!v) return;
    if (filtros.some((f) => f.tipo === tipo && f.valor.toLowerCase() === v.toLowerCase())) { setValor(''); return; }
    onChange([...filtros, { tipo, valor: v }]);
    setValor('');
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); adicionar(); }
  };

  return (
    <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Search size={14} className="text-emerald-700" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Filtros por advogado (opcional)</span>
      </div>

      <div className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-200/70 bg-white/60 px-3 py-2.5 text-xs text-emerald-800">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        <span>Cada filtro gera uma <strong>aba separada</strong> com os processos correspondentes. A aba <strong>Geral</strong> com todos sempre é incluída.</span>
      </div>

      <div className="mb-2 inline-flex gap-1 rounded-xl bg-white p-1">
        {(['nome', 'oab'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${tipo === t ? 'bg-emerald-700 text-white shadow-sm' : 'text-emerald-700 hover:bg-emerald-50'}`}
          >
            {t === 'nome' ? <><User size={12} /> Nome</> : <><Hash size={12} /> OAB</>}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text" value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={handleKey}
          placeholder={tipo === 'nome' ? 'Ex: Felipe, Paulo Eduardo…' : 'Ex: BA33407, SE6662'}
          className="field flex-1"
        />
        <button
          type="button" onClick={adicionar} disabled={!valor.trim()}
          className="btn btn-emerald flex-shrink-0 px-4 text-xs"
        >
          <Plus size={14} /> Adicionar
        </button>
      </div>

      {filtros.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {filtros.map((f, i) => (
            <span key={`${f.tipo}-${f.valor}-${i}`} className="chip border border-emerald-300 bg-white text-slate-700">
              <span className="font-bold text-emerald-700">{f.tipo === 'oab' ? 'OAB' : 'Adv'}:</span>
              {f.valor}
              <button type="button" onClick={() => onChange(filtros.filter((_, idx) => idx !== i))} className="ml-0.5 text-slate-400 hover:text-red-600" title="Remover">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-emerald-600">Sem filtros: planilha terá apenas a aba <strong>Geral</strong>.</p>
      )}
    </div>
  );
}
