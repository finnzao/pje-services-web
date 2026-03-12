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

  const borderClass = isDone
    ? 'border-emerald-300 bg-emerald-50'
    : isFailed
      ? 'border-red-300 bg-red-50'
      : 'border-blue-300 bg-blue-50';

  const Icon = isDone
    ? <CheckCircle size={16} className="text-emerald-600" />
    : isFailed
      ? <AlertCircle size={16} className="text-red-600" />
      : <Loader2 size={16} className="text-blue-600 animate-spin" />;

  return (
    <div className={`p-4 border-2 ${borderClass}`}>
      {/* Cabeçalho com status e ação de cancelar */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {Icon}
          <span className="text-sm font-bold text-slate-900">{estado.downloadMessage}</span>
        </div>
        {isActive && onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            className="text-xs font-bold text-red-600 hover:text-red-800 flex items-center gap-1"
          >
            <X size={14} /> Cancelar
          </button>
        )}
      </div>

      {/* Processo atual */}
      {isActive && estado.currentProcess && (
        <p className="text-xs text-slate-500 mb-2">
          Processo atual: <span className="font-mono font-semibold text-slate-700">{estado.currentProcess}</span>
        </p>
      )}

      {/* Barra de progresso */}
      {isActive && estado.totalProcesses > 0 && (
        <>
          <div className="w-full h-2 bg-slate-200 overflow-hidden mb-1">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${Math.min(estado.downloadProgress, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>
              {estado.completedProcesses + estado.failedProcesses}/{estado.totalProcesses} processos
            </span>
            <span>{estado.downloadProgress}%</span>
          </div>
        </>
      )}

      {/* Resumo final */}
      {isDone && (
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="p-2 bg-emerald-100 text-center">
            <div className="text-lg font-bold text-emerald-800">{estado.completedProcesses}</div>
            <div className="text-[10px] text-emerald-600">Baixados</div>
          </div>
          <div className="p-2 bg-red-100 text-center">
            <div className="text-lg font-bold text-red-800">{estado.failedProcesses}</div>
            <div className="text-[10px] text-red-600">Falhas</div>
          </div>
          <div className="p-2 bg-slate-100 text-center">
            <div className="text-lg font-bold text-slate-800">{formatFileSize(estado.bytesDownloaded)}</div>
            <div className="text-[10px] text-slate-600">Total</div>
          </div>
        </div>
      )}
    </div>
  );
}
