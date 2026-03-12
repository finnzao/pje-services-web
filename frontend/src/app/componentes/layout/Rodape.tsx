import React from 'react';

export const Rodape: React.FC = () => {
  return (
    <footer className="bg-white border-t-2 border-slate-200 mt-16">
      <div className="max-w-7xl mx-auto px-8 py-6">
        <p className="text-sm text-slate-600 text-center">
          Sistema Interno de Gestao do Forum - Versao 1.0 - {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
};
