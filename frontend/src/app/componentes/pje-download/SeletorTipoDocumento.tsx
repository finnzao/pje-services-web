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
    if (selecionadosLimpos.includes(nome)) {
      onChange(selecionadosLimpos.filter((s) => s !== nome));
    } else {
      onChange([...selecionadosLimpos, nome]);
    }
  };

  const removerTodos = () => {
    if (desabilitado) return;
    onChange([]);
  };

  return (
    <div className={desabilitado ? 'opacity-50 pointer-events-none' : ''}>
      <div className="flex items-center gap-2 mb-2">
        <FileText size={14} className="text-slate-500" />
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Tipos de documento (opcional)
        </label>
      </div>

      {}
      <div
        className={`mb-3 p-2.5 flex items-start gap-2 text-xs border ${
          baixaTudo
            ? 'bg-blue-50 border-blue-200 text-blue-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}
      >
        <Info size={12} className="flex-shrink-0 mt-0.5" />
        <div>
          {baixaTudo ? (
            <span>
              Sem filtro: <strong>todos os documentos</strong> de cada processo serão baixados.
            </span>
          ) : (
            <span>
              {selecionadosLimpos.length} tipo(s) selecionado(s). Cada processo gerará{' '}
              <strong>{selecionadosLimpos.length} arquivo(s)</strong> (uma requisição por tipo).
            </span>
          )}
        </div>
      </div>

      {}
      {selecionadosLimpos.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selecionadosLimpos.map((nome) => (
            <span
              key={nome}
              className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 text-white text-xs font-medium"
            >
              {nome}
              <button
                type="button"
                onClick={() => alternarTipo(nome)}
                className="hover:bg-slate-700 -mr-1 ml-1 p-0.5"
                aria-label={`Remover ${nome}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={removerTodos}
            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Limpar
          </button>
        </div>
      )}

      {}
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className="w-full flex items-center justify-between px-3 py-2 border-2 border-slate-200 text-sm hover:border-slate-300 bg-white"
      >
        <span className="text-slate-500">
          {aberto ? 'Fechar lista' : `Adicionar tipos de documento (${todosOsTipos.length} disponíveis)`}
        </span>
        {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {aberto && (
        <div className="mt-2 border-2 border-slate-200 bg-white">
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar tipo..."
              className="w-full px-2 py-1.5 border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {tiposFiltrados.length === 0 ? (
              <p className="p-3 text-xs text-slate-400 text-center">Nenhum tipo encontrado.</p>
            ) : (
              tiposFiltrados.map((tipo) => {
                const ativo = selecionadosLimpos.includes(tipo.nome);
                return (
                  <button
                    key={tipo.nome}
                    type="button"
                    onClick={() => alternarTipo(tipo.nome)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      ativo
                        ? 'bg-slate-900 text-white'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 border-2 flex items-center justify-center flex-shrink-0 ${
                        ativo ? 'border-white' : 'border-slate-300'
                      }`}
                    >
                      {ativo && <Check size={10} />}
                    </div>
                    <span className="flex-1 truncate">{tipo.nome}</span>
                    <span className={`text-[10px] font-mono ${ativo ? 'text-slate-300' : 'text-slate-400'}`}>
                      #{tipo.ids.join(',')}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
