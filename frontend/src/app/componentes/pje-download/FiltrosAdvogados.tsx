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
    const dup = filtros.some(
      (f) => f.tipo === tipo && f.valor.toLowerCase() === v.toLowerCase(),
    );
    if (dup) {
      setValor('');
      return;
    }
    onChange([...filtros, { tipo, valor: v }]);
    setValor('');
  };

  const remover = (idx: number) => {
    onChange(filtros.filter((_, i) => i !== idx));
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      adicionar();
    }
  };

  return (
    <div className="p-4 bg-amber-50 border-2 border-amber-200">
      <div className="flex items-center gap-2 mb-2">
        <Search size={14} className="text-amber-700" />
        <span className="text-xs font-bold text-amber-800 uppercase tracking-wide">
          Filtros por advogado (opcional)
        </span>
      </div>

      <div className="flex items-start gap-2 mb-2 p-2 bg-amber-100/50 border border-amber-200 text-xs text-amber-700">
        <Info size={12} className="flex-shrink-0 mt-0.5" />
        <span>
          Cada filtro adicionado gera uma <strong>aba separada</strong> na planilha
          contendo apenas processos com o advogado correspondente. A aba <strong>Geral</strong>
          {' '}com todos os processos sempre é incluída.
        </span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        {(['nome', 'oab'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTipo(t)}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              tipo === t
                ? 'bg-amber-700 text-white'
                : 'bg-white border border-amber-300 text-amber-700 hover:bg-amber-50'
            }`}
          >
            {t === 'nome' ? (
              <><User size={12} className="inline mr-1" />Nome</>
            ) : (
              <><Hash size={12} className="inline mr-1" />OAB</>
            )}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={handleKey}
          placeholder={tipo === 'nome' ? 'Ex: Felipe, Paulo Eduardo...' : 'Ex: BA33407, SE6662'}
          className="flex-1 px-3 py-2 border-2 border-amber-200 text-sm focus:border-amber-400 focus:outline-none bg-white"
        />
        <button
          type="button"
          onClick={adicionar}
          disabled={!valor.trim()}
          className="px-4 py-2 bg-amber-700 text-white text-xs font-bold hover:bg-amber-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
        >
          <Plus size={14} /> Adicionar
        </button>
      </div>

      {filtros.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {filtros.map((f, i) => (
            <span
              key={`${f.tipo}-${f.valor}-${i}`}
              className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-amber-300 text-xs"
            >
              <span className="font-bold text-amber-700">
                {f.tipo === 'oab' ? 'OAB' : 'Adv'}:
              </span>
              <span className="text-slate-700">{f.valor}</span>
              <button
                type="button"
                onClick={() => remover(i)}
                className="ml-1 text-slate-400 hover:text-red-600"
                title="Remover"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {filtros.length === 0 && (
        <p className="text-xs text-amber-600 mt-2">
          Sem filtros: planilha terá apenas a aba <strong>Geral</strong>.
        </p>
      )}
    </div>
  );
}
