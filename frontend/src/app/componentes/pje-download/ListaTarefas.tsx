'use client';

import React, { useState, useMemo } from 'react';
import { Star, List, ChevronDown, ChevronUp, ClipboardList, Info } from 'lucide-react';
import { CampoBusca } from './CampoBusca';
import type { TarefaPJE } from './types';

type Aba = 'todas' | 'favoritas';

interface ListaTarefasProps {
  tarefas: TarefaPJE[];
  tarefasFavoritas: TarefaPJE[];
  tarefaSelecionada: string;
  isFavorite: boolean;
  onSelecionar: (nome: string, favorita: boolean) => void;
}

const VISIVEIS_INICIAL = 10;

export function ListaTarefas({
  tarefas, tarefasFavoritas, tarefaSelecionada, isFavorite, onSelecionar,
}: ListaTarefasProps) {
  const [aba, setAba] = useState<Aba>('todas');
  const [busca, setBusca] = useState('');
  const [mostrarTodas, setMostrarTodas] = useState(false);

  const lista = aba === 'favoritas' ? tarefasFavoritas : tarefas;

  const filtradas = useMemo(() => {
    if (!busca.trim()) return lista;
    const t = busca.toLowerCase();
    return lista.filter((x) => x.nome.toLowerCase().includes(t));
  }, [lista, busca]);

  const visiveis = mostrarTodas ? filtradas : filtradas.slice(0, VISIVEIS_INICIAL);

  const handleTrocarAba = (novaAba: Aba) => {
    setAba(novaAba);
    setBusca('');
    setMostrarTodas(false);
  };

  return (
    <div>
      {/* Abas */}
      <div className="flex border-b-2 border-slate-200 mb-4">
        <button type="button" onClick={() => handleTrocarAba('todas')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 -mb-[2px] transition-colors ${
            aba === 'todas' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}>
          <List size={14} /> Todas as Tarefas
          <span className={`text-xs px-1.5 py-0.5 ${aba === 'todas' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>{tarefas.length}</span>
        </button>
        <button type="button" onClick={() => handleTrocarAba('favoritas')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 -mb-[2px] transition-colors ${
            aba === 'favoritas' ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}>
          <Star size={14} /> Minhas Tarefas
          <span className={`text-xs px-1.5 py-0.5 ${aba === 'favoritas' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{tarefasFavoritas.length}</span>
        </button>
      </div>

      {/* Info da aba */}
      <div className={`mb-4 p-3 flex items-start gap-2 text-xs ${
        aba === 'favoritas' ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-blue-50 border border-blue-200 text-blue-800'
      }`}>
        <Info size={14} className="flex-shrink-0 mt-0.5" />
        <span>
          {aba === 'favoritas'
            ? <><strong>Minhas Tarefas</strong> são as tarefas marcadas com estrela no PJE.</>
            : <><strong>Todas as Tarefas</strong> mostra a lista completa de tarefas disponíveis no seu perfil PJE.</>}
        </span>
      </div>

      <div className="mb-3">
        <CampoBusca valor={busca} onChange={(v) => { setBusca(v); setMostrarTodas(false); }} placeholder="Buscar tarefa..." />
      </div>

      {/* Lista */}
      {filtradas.length === 0 ? (
        <div className="p-6 text-center border-2 border-dashed border-slate-200">
          <ClipboardList size={20} className="text-slate-300 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            {busca ? 'Nenhuma tarefa encontrada.' : aba === 'favoritas' ? 'Nenhuma tarefa favorita.' : 'Nenhuma tarefa disponível.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {visiveis.map((tarefa) => {
            const sel = tarefaSelecionada === tarefa.nome && isFavorite === (aba === 'favoritas');
            return (
              <button key={`${aba}-${tarefa.id}-${tarefa.nome}`} type="button"
                onClick={() => onSelecionar(tarefa.nome, aba === 'favoritas')}
                className={`w-full text-left p-3 border-2 transition-all flex items-center justify-between ${
                  sel ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300 bg-white'
                }`}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {aba === 'favoritas' && <Star size={12} className="text-amber-500 flex-shrink-0" fill="currentColor" />}
                  <span className={`text-sm truncate ${sel ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{tarefa.nome}</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 flex-shrink-0 ml-2 ${
                  sel ? 'bg-slate-900 text-white' : tarefa.quantidadePendente > 500 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                }`}>{tarefa.quantidadePendente} processo{tarefa.quantidadePendente !== 1 ? 's' : ''}</span>
              </button>
            );
          })}
        </div>
      )}

      {filtradas.length > VISIVEIS_INICIAL && (
        <button type="button" onClick={() => setMostrarTodas(!mostrarTodas)}
          className="w-full mt-2 py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1 border border-slate-200 hover:border-slate-300 transition-colors">
          {mostrarTodas
            ? <><ChevronUp size={12} /> Mostrar menos</>
            : <><ChevronDown size={12} /> Ver todas ({filtradas.length - VISIVEIS_INICIAL} restantes)</>}
        </button>
      )}
    </div>
  );
}
