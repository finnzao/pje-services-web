'use client';

import React, { useMemo, useState } from 'react';
import { FileText, X, ChevronDown, ChevronUp, Info, Check } from 'lucide-react';
import { listDocumentTypes, SELECIONE_SENTINEL } from './tipos-documento';

interface SeletorTipoDocumentoProps {
  selecionados: string[];
  onChange: (selecionados: string[]) => void;
  desabilitado?: boolean;
}

export function SeletorTipoDocumento({ selecionados, onChange, desabilitado }: SeletorTipoDocumentoProps) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');

  const todosOsTipos = useMemo(
    () => listDocumentTypes().filter((t) => t.nome !== SELECIONE_SENTINEL),
    [],
  );

  const tiposFiltrados = useMemo(() => {
    if (!busca.trim()) return todosOsTipos;
    const t = busca.toLowerCase();
    return todosOsTipos.filter((tipo) => tipo.nome.toLowerCase().includes(t));
  }, [todosOsTipos, busca]);

  const selecionadosLimpos = selecionados.filter((s) => s && s !== SELECIONE_SENTINEL);
  const baixaTudo = selecionadosLimpos.length === 0;

  const alternarTipo = (nome: string) => {
    if (desabilitado) return;
    if (selecionadosLimpos.includes(nome)) onChange(selecionadosLimpos.filter((s) => s !== nome));
    else onChange([...selecionadosLimpos, nome]);
  };

  return (
    <div className={desabilitado ? 'pointer-events-none opacity-50' : ''}>
      <div className="mb-2 flex items-center gap-2">
        <FileText size={14} className="text-slate-500" />
        <span className="eyebrow">Tipos de documento (opcional)</span>
      </div>

      <div className={`mb-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs ${baixaTudo ? 'bg-navy-50 text-navy-700' : 'bg-brass-50 text-brass-600'}`}>
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        <span>
          {baixaTudo
            ? <>Sem filtro: <strong>todos os documentos</strong> de cada processo serão baixados.</>
            : <>{selecionadosLimpos.length} tipo(s): cada processo gerará <strong>{selecionadosLimpos.length} arquivo(s)</strong>.</>}
        </span>
      </div>

      {selecionadosLimpos.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {selecionadosLimpos.map((nome) => (
            <span key={nome} className="chip bg-navy-800 text-white">
              {nome}
              <button type="button" onClick={() => alternarTipo(nome)} className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-white/20" aria-label={`Remover ${nome}`}>
                <X size={10} />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onChange([])} className="rounded-full px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">Limpar</button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-500 transition-colors hover:border-slate-300"
      >
        <span>{aberto ? 'Fechar lista' : `Adicionar tipos (${todosOsTipos.length} disponíveis)`}</span>
        {aberto ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {aberto && (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white animate-fade">
          <div className="border-b border-slate-100 p-2">
            <input
              type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar tipo…" autoFocus
              className="field py-2 text-sm"
            />
          </div>
          <div className="scroll-area max-h-64 overflow-y-auto">
            {tiposFiltrados.length === 0 ? (
              <p className="p-3 text-center text-xs text-slate-400">Nenhum tipo encontrado.</p>
            ) : tiposFiltrados.map((tipo) => {
              const ativo = selecionadosLimpos.includes(tipo.nome);
              return (
                <button
                  key={tipo.nome}
                  type="button"
                  onClick={() => alternarTipo(tipo.nome)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${ativo ? 'bg-navy-800 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 ${ativo ? 'border-white' : 'border-slate-300'}`}>
                    {ativo && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="flex-1 truncate">{tipo.nome}</span>
                  <span className={`font-mono text-[10px] ${ativo ? 'text-white/60' : 'text-slate-400'}`}>#{tipo.ids.join(',')}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
