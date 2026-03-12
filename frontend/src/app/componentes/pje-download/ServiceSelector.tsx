'use client';

import React from 'react';
import { Download, FileSpreadsheet, CheckCircle } from 'lucide-react';
import type { ServicoAtivo } from './types';

interface ServicoItem {
  id: ServicoAtivo;
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  cor: string;
  corAtiva: string;
  corIcone: string;
}

const SERVICOS: ServicoItem[] = [
  {
    id: 'processos',
    icone: <Download size={24} />,
    titulo: 'Download de Processos',
    descricao: 'Baixar PDFs dos processos disponíveis no PJE',
    cor: 'border-slate-900 bg-slate-50',
    corAtiva: 'bg-slate-900 text-white',
    corIcone: 'text-slate-700',
  },
  {
    id: 'advogados',
    icone: <FileSpreadsheet size={24} />,
    titulo: 'Planilha de Advogados',
    descricao: 'Gerar planilha com nomes dos advogados presentes nos processos',
    cor: 'border-emerald-700 bg-emerald-50',
    corAtiva: 'bg-emerald-700 text-white',
    corIcone: 'text-emerald-700',
  },
];

interface ServiceSelectorProps {
  servicoSelecionado: ServicoAtivo | null;
  onSelecionar: (servico: ServicoAtivo) => void;
}

export function ServiceSelector({ servicoSelecionado, onSelecionar }: ServiceSelectorProps) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3 block">
        1. Selecione o serviço
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SERVICOS.map((servico) => {
          const selecionado = servicoSelecionado === servico.id;
          return (
            <button
              key={servico.id}
              type="button"
              onClick={() => onSelecionar(servico.id)}
              className={`relative p-5 border-2 text-left transition-all group ${
                selecionado
                  ? servico.cor
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              {selecionado && (
                <div className="absolute top-3 right-3">
                  <CheckCircle size={18} className={servico.id === 'processos' ? 'text-slate-700' : 'text-emerald-700'} />
                </div>
              )}
              <div className={`inline-flex p-3 mb-3 transition-colors ${
                selecionado ? servico.corAtiva : `bg-slate-100 ${servico.corIcone} group-hover:bg-slate-200`
              }`}>
                {servico.icone}
              </div>
              <h4 className={`text-base font-bold mb-1 ${
                selecionado ? 'text-slate-900' : 'text-slate-700'
              }`}>
                {servico.titulo}
              </h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                {servico.descricao}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
