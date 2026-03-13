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
  { id: 'by_task',   icone: <ClipboardList size={16} />, rotulo: 'Por Tarefa',   descricao: 'Baixar processos de uma tarefa' },
  { id: 'by_tag',    icone: <Tag size={16} />,           rotulo: 'Por Etiqueta', descricao: 'Baixar por etiqueta/marcador' },
];

interface DownloadModeSelectorProps {
  modoSelecionado: PJEDownloadMode;
  onSelecionar: (modo: PJEDownloadMode) => void;
  desabilitado?: boolean;
}

export function DownloadModeSelector({ modoSelecionado, onSelecionar, desabilitado = false }: DownloadModeSelectorProps) {
  return (
    <div className={desabilitado ? 'opacity-50 pointer-events-none' : ''}>
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3 block">
        2. Modo de Download
      </label>
      <div className="space-y-2">
        {MODOS.map((modo) => {
          const selecionado = modoSelecionado === modo.id;
          return (
            <button
              key={modo.id}
              type="button"
              onClick={() => onSelecionar(modo.id)}
              disabled={desabilitado}
              className={`w-full flex items-center gap-3 p-3 border-2 text-left transition-all ${
                selecionado
                  ? 'border-slate-900 bg-slate-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              {/* Radio button visual */}
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                selecionado ? 'border-slate-900' : 'border-slate-300'
              }`}>
                {selecionado && <div className="w-2 h-2 rounded-full bg-slate-900" />}
              </div>

              <span className={`flex-shrink-0 ${selecionado ? 'text-slate-900' : 'text-slate-400'}`}>
                {modo.icone}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-bold block ${selecionado ? 'text-slate-900' : 'text-slate-600'}`}>
                  {modo.rotulo}
                </span>
                <span className="text-xs text-slate-400">{modo.descricao}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
