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

  const trocarAba = (nova: Aba) => { setAba(nova); setBusca(''); setMostrarTodas(false); };

  return (
    <div>
      {/* Abas */}
      <div className="mb-4 flex gap-1 rounded-xl bg-slate-100/80 p-1">
        <TabBtn ativo={aba === 'todas'} onClick={() => trocarAba('todas')} accent="navy">
          <List size={14} /> Todas <Pill ativo={aba === 'todas'} accent="navy">{tarefas.length}</Pill>
        </TabBtn>
        <TabBtn ativo={aba === 'favoritas'} onClick={() => trocarAba('favoritas')} accent="brass">
          <Star size={14} /> Minhas <Pill ativo={aba === 'favoritas'} accent="brass">{tarefasFavoritas.length}</Pill>
        </TabBtn>
      </div>

      <div className={`mb-4 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs ${aba === 'favoritas' ? 'bg-brass-50 text-brass-600' : 'bg-navy-50 text-navy-700'}`}>
        <Info size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          {aba === 'favoritas'
            ? <><strong>Minhas tarefas</strong> são as marcadas com estrela no PJE.</>
            : <><strong>Todas as tarefas</strong> mostra a lista completa do seu perfil.</>}
        </span>
      </div>

      <div className="mb-3">
        <CampoBusca valor={busca} onChange={(v) => { setBusca(v); setMostrarTodas(false); }} placeholder="Buscar tarefa…" />
      </div>

      {filtradas.length === 0 ? (
        <Vazio busca={!!busca} aba={aba} />
      ) : (
        <div className="scroll-area max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {visiveis.map((tarefa) => {
            const sel = tarefaSelecionada === tarefa.nome && isFavorite === (aba === 'favoritas');
            const muitos = tarefa.quantidadePendente > 500;
            return (
              <button
                key={`${aba}-${tarefa.id}-${tarefa.nome}`}
                type="button"
                onClick={() => onSelecionar(tarefa.nome, aba === 'favoritas')}
                className={`row flex items-center justify-between gap-2 px-3.5 py-3 ${sel ? 'row-on' : ''}`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {aba === 'favoritas' && <Star size={12} className="flex-shrink-0 fill-brass-400 text-brass-400" />}
                  <span className={`truncate text-sm ${sel ? 'font-semibold text-ink' : 'text-slate-700'}`}>{tarefa.nome}</span>
                </span>
                <span className={`chip flex-shrink-0 ${sel ? 'bg-navy-800 text-white' : muitos ? 'bg-brass-50 text-brass-600' : 'bg-slate-100 text-slate-500'}`}>
                  {tarefa.quantidadePendente}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {filtradas.length > VISIVEIS_INICIAL && (
        <button
          type="button"
          onClick={() => setMostrarTodas(!mostrarTodas)}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-navy-700"
        >
          {mostrarTodas
            ? <><ChevronUp size={13} /> Mostrar menos</>
            : <><ChevronDown size={13} /> Ver todas ({filtradas.length - VISIVEIS_INICIAL} restantes)</>}
        </button>
      )}
    </div>
  );
}

function TabBtn({ ativo, onClick, accent, children }: { ativo: boolean; onClick: () => void; accent: 'navy' | 'brass'; children: React.ReactNode }) {
  const cor = ativo ? (accent === 'brass' ? 'text-brass-600' : 'text-navy-800') : 'text-slate-500 hover:text-slate-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all ${ativo ? 'bg-white shadow-sm' : ''} ${cor}`}
    >
      {children}
    </button>
  );
}

function Pill({ ativo, accent, children }: { ativo: boolean; accent: 'navy' | 'brass'; children: React.ReactNode }) {
  const cls = ativo
    ? accent === 'brass' ? 'bg-brass-100 text-brass-600' : 'bg-navy-100 text-navy-700'
    : 'bg-slate-200 text-slate-500';
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>;
}

function Vazio({ busca, aba }: { busca: boolean; aba: Aba }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 p-7 text-center">
      <ClipboardList size={22} className="mx-auto mb-2 text-slate-300" />
      <p className="text-xs text-slate-400">
        {busca ? 'Nenhuma tarefa encontrada.' : aba === 'favoritas' ? 'Nenhuma tarefa favorita.' : 'Nenhuma tarefa disponível.'}
      </p>
    </div>
  );
}
