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
      <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field pl-10"
      />
    </div>
  );
}
