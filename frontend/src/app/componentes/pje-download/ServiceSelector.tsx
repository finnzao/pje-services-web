'use client';

import React from 'react';
import { Download, FileSpreadsheet, Search, Hash, Tags, Check, Eye, PenLine } from 'lucide-react';
import type { ServicoAtivo } from './types';

/**
 * Cor com significado: navy = consulta/download, esmeralda = gera planilha,
 * latão = altera dados no PJE (mesma cor do botão de escrita nas telas).
 */
type Accent = 'navy' | 'emerald' | 'brass';

interface ServicoItem {
  id: ServicoAtivo;
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  accent: Accent;
}

interface Grupo {
  id: string;
  rotulo: string;
  icone: React.ReactNode;
  descricao: string;
  servicos: ServicoItem[];
}

const GRUPOS: Grupo[] = [
  {
    id: 'leitura',
    rotulo: 'Consultar e gerar',
    icone: <Eye size={13} />,
    descricao: 'Só leem o PJE.',
    servicos: [
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
        titulo: 'Informações Completas dos Processos',
        descricao: 'Planilha com partes (CPF/CNPJ), advogados, tarefa, etiquetas e movimentação de cada processo.',
        accent: 'emerald',
      },
      {
        id: 'pesquisa',
        icone: <Search size={22} />,
        titulo: 'Pesquisa Geral de Processos',
        descricao: 'Pesquise na Consulta Processual e baixe ou gere planilha.',
        accent: 'navy',
      },
      {
        id: 'digito',
        icone: <Hash size={22} />,
        titulo: 'Planilha por Dígito',
        descricao: 'Distribua o acervo entre servidores pelo dígito do processo, com prioridades.',
        accent: 'emerald',
      },
    ],
  },
  {
    id: 'escrita',
    rotulo: 'Alterar no PJE',
    icone: <PenLine size={13} />,
    descricao: 'Modificam os processos. Sempre com simulação antes.',
    servicos: [
      {
        id: 'etiquetas',
        icone: <Tags size={22} />,
        titulo: 'Etiquetar Processos Parados',
        descricao: 'Aplique uma etiqueta do PJE nos processos sem movimentação há mais de N dias (padrão 120).',
        accent: 'brass',
      },
    ],
  },
];

const ESTILO: Record<Accent, { on: string; off: string; check: string }> = {
  navy: { on: 'bg-navy-800 text-white', off: 'bg-navy-50 text-navy-700', check: 'bg-navy-700' },
  emerald: { on: 'bg-emerald-700 text-white', off: 'bg-emerald-50 text-emerald-700', check: 'bg-emerald-600' },
  brass: { on: 'bg-brass-500 text-white', off: 'bg-brass-50 text-brass-600', check: 'bg-brass-500' },
};

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

      <div className="space-y-5">
        {GRUPOS.map((grupo) => (
          <section key={grupo.id} aria-labelledby={`grupo-${grupo.id}`}>
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-600" id={`grupo-${grupo.id}`}>
                {grupo.icone} {grupo.rotulo}
              </span>
              <span aria-hidden>·</span>
              <span>{grupo.descricao}</span>
            </div>
            <div className={`grid grid-cols-1 gap-3 ${grupo.servicos.length > 1 ? 'sm:grid-cols-2' : ''}`}>
              {grupo.servicos.map((s) => {
                const on = servicoSelecionado === s.id;
                const estilo = ESTILO[s.accent];
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelecionar(s.id)}
                    aria-pressed={on}
                    className={`pick group p-5 ${on ? 'pick-on' : ''} ${grupo.servicos.length === 1 ? 'sm:flex sm:items-center sm:gap-4' : ''}`}
                  >
                    {on && (
                      <span className={`absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full text-white ${estilo.check}`} aria-hidden>
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                    <span className={`mb-3.5 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors sm:mb-0 ${on ? estilo.on : estilo.off}`} aria-hidden>
                      {s.icone}
                    </span>
                    <span className="block min-w-0">
                      <h4 className="font-display text-base font-semibold text-ink">{s.titulo}</h4>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{s.descricao}</p>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
