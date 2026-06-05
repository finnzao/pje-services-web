'use client';

import { useState } from 'react';
import { CheckCircle, AlertCircle, Loader2, X, Download } from 'lucide-react';

interface ProgressoJobProps {
  status: string;
  progress: number;
  message: string;
  processedCount: number;
  totalProcesses: number;
  onDownload?: () => Promise<void>;
  onCancelar?: () => void;
}

export function ProgressoJob({
  status, progress, message, processedCount, totalProcesses,
  onDownload, onCancelar,
}: ProgressoJobProps) {
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

  const isDone = ['completed', 'failed', 'cancelled'].includes(status);
  const tone = status === 'completed'
    ? 'border-emerald-200 bg-emerald-50'
    : status === 'failed' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50/60';

  const Icon = status === 'completed'
    ? <CheckCircle size={16} className="text-emerald-600" />
    : status === 'failed' ? <AlertCircle size={16} className="text-red-600" /> : <Loader2 size={16} className="animate-spin text-emerald-600" />;

  const handleDownload = async () => {
    if (!onDownload) return;
    setBaixando(true); setErroDownload(null);
    try { await onDownload(); }
    catch (err: any) { setErroDownload(err.message || 'Erro ao baixar planilha'); }
    finally { setBaixando(false); }
  };

  return (
    <div className={`rounded-2xl border p-4 animate-fade ${tone}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon}
          <span className="truncate text-sm font-semibold text-ink">{message}</span>
        </div>
        {!isDone && onCancelar && (
          <button type="button" onClick={onCancelar} className="flex-shrink-0 text-red-600 hover:text-red-800"><X size={15} /></button>
        )}
      </div>

      {!isDone && (
        <div className="progress-track mb-1">
          <div className="progress-bar bg-emerald-600" style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="flex justify-between text-xs text-slate-500">
        <span>{processedCount}/{totalProcesses || '?'} processos</span>
        <span>{progress}%</span>
      </div>

      {status === 'completed' && onDownload && (
        <>
          <button type="button" onClick={handleDownload} disabled={baixando} className="btn btn-emerald mt-3 w-full py-2.5 text-sm">
            {baixando ? <><Loader2 size={16} className="animate-spin" /> Baixando…</> : <><Download size={16} /> Baixar planilha</>}
          </button>
          {erroDownload && <p className="mt-2 text-center text-xs text-red-600">{erroDownload}</p>}
        </>
      )}
    </div>
  );
}
