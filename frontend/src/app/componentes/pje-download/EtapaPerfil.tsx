'use client';

import React from 'react';
import { User, Star, Loader2, AlertCircle, Building2 } from 'lucide-react';
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
    <div className="max-w-lg mx-auto">
      <div className="border-2 border-slate-200 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-emerald-100 flex items-center justify-center"><User size={20} className="text-emerald-700" /></div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Selecionar Perfil</h3>
            <p className="text-sm text-slate-500">Logado como {usuario.nomeUsuario}</p>
          </div>
        </div>
        {erro && (
          <div className="mb-4 p-3 bg-red-50 border-2 border-red-200 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        )}
        <div className="space-y-2">
          {perfis.map((perfil) => (
            <button key={perfil.indice} type="button" onClick={() => onSelecionar(perfil)} disabled={carregando}
              className="w-full text-left p-4 border-2 border-slate-200 hover:border-slate-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-start gap-3">
              <Building2 size={18} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-900">{perfil.nome}</span>
                  {perfil.favorito && <Star size={12} className="text-amber-500 fill-amber-500" />}
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">{perfil.orgao}</p>
              </div>
              {carregando ? <Loader2 size={16} className="animate-spin text-slate-400" /> : <span className="text-xs text-slate-400 font-mono">#{perfil.indice}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
