'use client';

import React from 'react';
import { Building2 } from 'lucide-react';
import type { PerfilPJE } from './types';

interface ProfileBadgeProps {
  perfil: PerfilPJE;
  className?: string;
}

export function ProfileBadge({ perfil, className = '' }: ProfileBadgeProps) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-600">
        <Building2 size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Perfil ativo</p>
        <p className="truncate text-sm font-semibold text-ink" title={perfil.nome}>{perfil.nome}</p>
      </div>
    </div>
  );
}
