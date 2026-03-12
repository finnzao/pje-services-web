'use client';

import { Search } from 'lucide-react';

interface CampoBuscaProps {
  valor: string;
  onChange: (valor: string) => void;
  placeholder?: string;
}

export function CampoBusca({ valor, onChange, placeholder = 'Buscar...' }: CampoBuscaProps) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-4 py-2 border-2 border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
      />
    </div>
  );
}
