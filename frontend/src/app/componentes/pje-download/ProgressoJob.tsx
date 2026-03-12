'use client';

import { CheckCircle, AlertCircle, Loader2, X, Download } from 'lucide-react';

interface ProgressoJobProps {
  status: string;
  progress: number;
  message: string;
  processedCount: number;
  totalProcesses: number;
  downloadUrl?: string;
  onCancelar?: () => void;
}

export function ProgressoJob({
  status, progress, message, processedCount, totalProcesses,
  downloadUrl, onCancelar,
}: ProgressoJobProps) {
  const isDone = ['completed', 'failed', 'cancelled'].includes(status);

  const borderClass =
    status === 'completed' ? 'border-emerald-300 bg-emerald-50' :
    status === 'failed' ? 'border-red-300 bg-red-50' :
    'border-blue-300 bg-blue-50';

  const Icon =
    status === 'completed' ? <CheckCircle size={16} className="text-emerald-600" /> :
    status === 'failed' ? <AlertCircle size={16} className="text-red-600" /> :
    <Loader2 size={16} className="text-blue-600 animate-spin" />;

  return (
    <div className={`p-4 border-2 ${borderClass}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {Icon}
          <span className="text-sm font-bold text-slate-900">{message}</span>
        </div>
        {!isDone && onCancelar && (
          <button type="button" onClick={onCancelar} className="text-xs font-bold text-red-600 hover:text-red-800">
            <X size={14} />
          </button>
        )}
      </div>

      {!isDone && (
        <div className="w-full h-2 bg-slate-200 overflow-hidden mb-1">
          <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="flex justify-between text-xs text-slate-500">
        <span>{processedCount}/{totalProcesses || '?'} processos</span>
        <span>{progress}%</span>
      </div>

      {status === 'completed' && downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 py-2 px-4 bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">
          <Download size={16} /> Baixar Planilha
        </a>
      )}
    </div>
  );
}
