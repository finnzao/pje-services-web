'use client';

import React from 'react';
import { User } from 'lucide-react';
import type { PerfilPJE } from './types';

interface ProfileBadgeProps {
  perfil: PerfilPJE;
  className?: string;
}

// Exibe informações do perfil de forma minimalista
export function ProfileBadge({ perfil, className = '' }: ProfileBadgeProps) {
  // Truncar nome do perfil se muito longo
  const nomeCurto = perfil.nome.length > 40
    ? perfil.nome.substring(0, 37) + '...'
    : perfil.nome;

  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <User size={12} className="text-slate-400 flex-shrink-0" />
      <div className="min-w-0">
        <span className="text-slate-400 mr-1">Perfil ativo</span>
        <span className="font-semibold text-slate-600 truncate" title={perfil.nome}>
          {nomeCurto}
        </span>
      </div>
    </div>
  );
}
