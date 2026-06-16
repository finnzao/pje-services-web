'use client';

import React from 'react';
import { Download, FileSpreadsheet, Search, Check } from 'lucide-react';
import type { ServicoAtivo } from './types';

interface ServicoItem {
  id: ServicoAtivo;
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  accent: 'navy' | 'emerald';
}

const SERVICOS: ServicoItem[] = [
  {
    id: 'processos',
    icone: <Download size={22} />,
    titulo: 'Download de Processos',
    descricao: 'Baixe os PDFs dos processos disponíveis no PJE.',
    accent: 'navy',
  },
  {
    id: 'advogados',
    icone: <FileSpreadsheet size={22} />,
    titulo: 'Planilha de Advogados',
    descricao: 'Gere uma planilha com os advogados de cada processo.',
    accent: 'emerald',
  },
  {
    id: 'pesquisa',
    icone: <Search size={22} />,
    titulo: 'Pesquisa Geral de Processos',
    descricao: 'Pesquise na Consulta Processual e baixe ou gere planilha.',
    accent: 'navy',
  },
];

interface ServiceSelectorProps {
  servicoSelecionado: ServicoAtivo | null;
  onSelecionar: (servico: ServicoAtivo) => void;
}

export function ServiceSelector({ servicoSelecionado, onSelecionar }: ServiceSelectorProps) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="num-badge">1</span>
        <span className="eyebrow">Selecione o serviço</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SERVICOS.map((s) => {
          const on = servicoSelecionado === s.id;
          const isEmerald = s.accent === 'emerald';
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelecionar(s.id)}
              className={`pick group p-5 ${on ? 'pick-on' : ''}`}
            >
              {on && (
                <span className={`absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full text-white ${isEmerald ? 'bg-emerald-600' : 'bg-navy-700'}`}>
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <span
                className={`mb-3.5 inline-flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${
                  on
                    ? isEmerald ? 'bg-emerald-700 text-white' : 'bg-navy-800 text-white'
                    : isEmerald ? 'bg-emerald-50 text-emerald-700' : 'bg-navy-50 text-navy-700'
                }`}
              >
                {s.icone}
              </span>
              <h4 className="font-display text-base font-semibold text-ink">{s.titulo}</h4>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.descricao}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
