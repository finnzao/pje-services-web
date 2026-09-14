'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Loader2, X, Download, Ban } from 'lucide-react';

interface ProgressoJobProps {
  status: string;
  progress: number;
  message: string;
  processedCount: number;
  totalProcesses: number;
  onDownload?: () => Promise<void>;
  onCancelar?: () => void;
  /** Pede confirmação antes de cancelar (ex.: execução que já escreve no PJE). */
  confirmarCancelamento?: boolean;
  /** Rótulo da unidade contada (padrão "processos"). */
  unidade?: string;
}

export function ProgressoJob({
  status, progress, message, processedCount, totalProcesses,
  onDownload, onCancelar, confirmarCancelamento = false, unidade = 'processos',
}: ProgressoJobProps) {
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  const isDone = ['completed', 'failed', 'cancelled'].includes(status);
  const isCancelling = status === 'cancelling';
  const tone = status === 'completed'
    ? 'border-emerald-200 bg-emerald-50'
    : status === 'failed' ? 'border-red-200 bg-red-50'
      : status === 'cancelled' ? 'border-slate-200 bg-slate-50'
        : 'border-emerald-200 bg-emerald-50/60';

  const Icon = status === 'completed'
    ? <CheckCircle size={16} className="shrink-0 text-emerald-600" aria-hidden />
    : status === 'failed' ? <AlertCircle size={16} className="shrink-0 text-red-600" aria-hidden />
      : status === 'cancelled' ? <Ban size={16} className="shrink-0 text-slate-500" aria-hidden />
        : <Loader2 size={16} className="shrink-0 animate-spin text-emerald-600" aria-hidden />;

  // Um clique fora do card ou a conclusão do job desarma a confirmação pendente.
  useEffect(() => { if (isDone) setConfirmando(false); }, [isDone]);

  const handleDownload = async () => {
    if (!onDownload) return;
    setBaixando(true); setErroDownload(null);
    try { await onDownload(); }
    catch (err: any) { setErroDownload(err.message || 'Erro ao baixar planilha'); }
    finally { setBaixando(false); }
  };

  const handleCancelarClick = () => {
    if (!onCancelar) return;
    if (confirmarCancelamento && !confirmando) { setConfirmando(true); return; }
    setConfirmando(false);
    onCancelar();
  };

  return (
    <div className={`rounded-2xl border p-4 animate-fade ${tone}`} role="status" aria-live="polite" aria-atomic="true">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5">{Icon}</span>
          <span className="break-words text-sm font-semibold text-ink">{message}</span>
        </div>
        {!isDone && !isCancelling && onCancelar && !confirmando && (
          <button type="button" onClick={handleCancelarClick} className="btn btn-danger shrink-0 px-3 py-1.5 text-xs">
            <X size={13} /> Cancelar
          </button>
        )}
      </div>

      {confirmando && !isDone && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-red-200 bg-white px-3 py-2.5 text-xs text-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <span>As alterações já feitas no PJE <strong>não</strong> são desfeitas. Cancelar mesmo assim?</span>
          <span className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setConfirmando(false)} className="btn btn-ghost px-3 py-1.5 text-xs">Continuar</button>
            <button type="button" onClick={handleCancelarClick} className="btn btn-danger px-3 py-1.5 text-xs">Sim, cancelar</button>
          </span>
        </div>
      )}

      {!isDone && (
        <div className="progress-track mb-1" aria-hidden>
          <div className="progress-bar bg-emerald-600" style={{ width: `${progress}%` }} />
        </div>
      )}

      <div className="flex justify-between text-xs text-slate-600">
        <span>{processedCount}/{totalProcesses || '?'} {unidade}</span>
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
