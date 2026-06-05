'use client';

import React from 'react';
import { Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';
import type { EstadoExecucao } from './types';
import { formatFileSize } from './types';

interface ExecutionStatusProps {
  estado: EstadoExecucao;
  onCancelar?: () => void;
}

export function ExecutionStatus({ estado, onCancelar }: ExecutionStatusProps) {
  if (estado.downloadStatus === 'idle') return null;

  const isActive = estado.isDownloading;
  const isDone = estado.downloadStatus === 'completed';
  const isFailed = estado.downloadStatus === 'failed' || estado.downloadStatus === 'cancelled';

  const tone = isDone
    ? 'border-emerald-200 bg-emerald-50'
    : isFailed ? 'border-red-200 bg-red-50' : 'border-navy-200 bg-navy-50';

  const Icon = isDone
    ? <CheckCircle size={16} className="text-emerald-600" />
    : isFailed ? <AlertCircle size={16} className="text-red-600" /> : <Loader2 size={16} className="animate-spin text-navy-600" />;

  return (
    <div className={`rounded-2xl border p-4 animate-fade ${tone}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon}
          <span className="truncate text-sm font-semibold text-ink">{estado.downloadMessage}</span>
        </div>
        {isActive && onCancelar && (
          <button type="button" onClick={onCancelar} className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800">
            <X size={14} /> Cancelar
          </button>
        )}
      </div>

      {isActive && estado.currentProcess && (
        <p className="mb-2 text-xs text-slate-500">
          Processo atual: <span className="font-mono font-semibold text-slate-700">{estado.currentProcess}</span>
        </p>
      )}

      {isActive && estado.totalProcesses > 0 && (
        <>
          <div className="progress-track mb-1">
            <div className="progress-bar bg-navy-700" style={{ width: `${Math.min(estado.downloadProgress, 100)}%` }} />
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>{estado.completedProcesses + estado.failedProcesses}/{estado.totalProcesses} processos</span>
            <span>{estado.downloadProgress}%</span>
          </div>
        </>
      )}

      {isDone && (
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          <Stat valor={estado.completedProcesses} rotulo="Baixados" tone="emerald" />
          <Stat valor={estado.failedProcesses} rotulo="Falhas" tone="red" />
          <Stat valor={formatFileSize(estado.bytesDownloaded)} rotulo="Total" tone="slate" />
        </div>
      )}
    </div>
  );
}

function Stat({ valor, rotulo, tone }: { valor: React.ReactNode; rotulo: string; tone: 'emerald' | 'red' | 'slate' }) {
  const map = {
    emerald: 'bg-white border-emerald-200 text-emerald-700',
    red: 'bg-white border-red-200 text-red-700',
    slate: 'bg-white border-slate-200 text-slate-700',
  } as const;
  return (
    <div className={`rounded-xl border p-2.5 text-center ${map[tone]}`}>
      <div className="text-lg font-bold leading-none">{valor}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide opacity-70">{rotulo}</div>
    </div>
  );
}
