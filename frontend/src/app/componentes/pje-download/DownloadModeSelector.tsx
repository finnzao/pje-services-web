'use client';

import React from 'react';
import { ClipboardList, Tag, Hash } from 'lucide-react';
import type { PJEDownloadMode } from './types';

interface ModoItem {
  id: PJEDownloadMode;
  icone: React.ReactNode;
  rotulo: string;
  descricao: string;
}

const MODOS: ModoItem[] = [
  { id: 'by_task',   icone: <ClipboardList size={16} />, rotulo: 'Por Tarefa',   descricao: 'Processos de uma tarefa' },
  { id: 'by_tag',    icone: <Tag size={16} />,           rotulo: 'Por Etiqueta', descricao: 'Por etiqueta / marcador' },
  { id: 'by_number', icone: <Hash size={16} />,          rotulo: 'Por Lista',    descricao: 'Lista de números CNJ' },
];

interface DownloadModeSelectorProps {
  modoSelecionado: PJEDownloadMode;
  onSelecionar: (modo: PJEDownloadMode) => void;
  desabilitado?: boolean;
  servico?: 'processos' | 'advogados' | null;
  modosSuportados?: PJEDownloadMode[];
}

export function DownloadModeSelector({
  modoSelecionado, onSelecionar, desabilitado = false,
  servico = null, modosSuportados,
}: DownloadModeSelectorProps) {
  const modosVisiveis = modosSuportados
    ? MODOS.filter((m) => modosSuportados.includes(m.id))
    : servico === 'advogados'
      ? MODOS.filter((m) => m.id !== 'by_number')
      : MODOS;

  return (
    <div className={desabilitado ? 'pointer-events-none opacity-50' : ''}>
      <div className="mb-3 flex items-center gap-2">
        <span className="num-badge">2</span>
        <span className="eyebrow">Modo de download</span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3">
        {modosVisiveis.map((modo) => {
          const on = modoSelecionado === modo.id;
          return (
            <button
              key={modo.id}
              type="button"
              onClick={() => onSelecionar(modo.id)}
              disabled={desabilitado}
              className={`pick group p-3.5 ${on ? 'pick-on' : ''}`}
            >
              <span className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${on ? 'bg-navy-800 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-navy-50 group-hover:text-navy-600'}`}>
                {modo.icone}
              </span>
              <span className="block text-sm font-semibold text-ink">{modo.rotulo}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{modo.descricao}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
