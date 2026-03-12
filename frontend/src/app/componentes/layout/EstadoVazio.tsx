import React from 'react';
import { SearchX } from 'lucide-react';

interface EstadoVazioProps {
  titulo?: string;
  descricao?: string;
  icone?: React.ReactNode;
}

export function EstadoVazio({
  titulo = 'Nenhum registro encontrado',
  descricao = 'Tente ajustar os filtros ou cadastrar um novo registro.',
  icone,
}: EstadoVazioProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 bg-slate-100 flex items-center justify-center mb-4">
        {icone || <SearchX size={28} className="text-slate-400" strokeWidth={1.5} />}
      </div>
      <p className="text-base font-semibold text-slate-700 mb-1">{titulo}</p>
      <p className="text-sm text-slate-500 max-w-md">{descricao}</p>
    </div>
  );
}
