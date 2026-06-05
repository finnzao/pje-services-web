'use client';

import React from 'react';
import { User, Star, Loader2, AlertCircle, Building2, ChevronRight } from 'lucide-react';
import type { UsuarioPJE, PerfilPJE } from './types';

interface Props {
  usuario: UsuarioPJE;
  perfis: PerfilPJE[];
  carregando: boolean;
  erro: string | null;
  onSelecionar: (perfil: PerfilPJE) => void;
}

export function EtapaPerfil({ usuario, perfis, carregando, erro, onSelecionar }: Props) {
  return (
    <div className="mx-auto max-w-lg animate-rise">
      <div className="surface overflow-hidden">
        <div className="flex items-center gap-4 border-b border-slate-100 px-7 py-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <User size={20} />
          </div>
          <div>
            <h3 className="font-display text-xl font-semibold text-ink">Selecione um perfil</h3>
            <p className="text-sm text-slate-500">Conectado como {usuario.nomeUsuario}</p>
          </div>
        </div>

        <div className="px-7 py-6">
          {erro && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
              <span>{erro}</span>
            </div>
          )}

          <div className="stagger space-y-2.5">
            {perfis.map((perfil) => (
              <button
                key={perfil.indice}
                type="button"
                onClick={() => onSelecionar(perfil)}
                disabled={carregando}
                className="pick group flex items-center gap-3.5 p-4 disabled:opacity-60"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-navy-50 group-hover:text-navy-600">
                  <Building2 size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink">{perfil.nome}</span>
                    {perfil.favorito && <Star size={12} className="flex-shrink-0 fill-brass-400 text-brass-400" />}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{perfil.orgao || 'Órgão não informado'}</span>
                </span>
                {carregando
                  ? <Loader2 size={16} className="animate-spin text-slate-400" />
                  : <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-navy-500" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
