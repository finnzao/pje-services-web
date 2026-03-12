import React from 'react';
import { User, LogOut } from 'lucide-react';

interface CabecalhoProps {
  nomeUsuario: string;
  subtitulo: string;
  tipoPerfil: 'administrador' | 'magistrado' | 'servidor';
}

export const Cabecalho: React.FC<CabecalhoProps> = ({ nomeUsuario, subtitulo, tipoPerfil }) => {
  const obterRotuloPerfil = () => {
    switch (tipoPerfil) {
      case 'administrador': return 'Administracao';
      case 'magistrado': return 'Magistrado';
      case 'servidor': return 'Cartorio / Servidor';
    }
  };

  return (
    <header className="bg-slate-900 border-b-4 border-slate-700">
      <div className="max-w-7xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">FORUM HUB</h1>
            <p className="text-sm text-slate-300 mt-1 font-medium">{obterRotuloPerfil()}</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 pr-6 border-r border-slate-700">
              <div className="w-10 h-10 bg-slate-700 text-white flex items-center justify-center font-bold text-sm">
                <User size={20} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{nomeUsuario}</p>
                <p className="text-xs text-slate-400">{subtitulo}</p>
              </div>
            </div>
            <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">
              <LogOut size={16} /> Sair
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
