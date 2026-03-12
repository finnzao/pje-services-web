'use client';

import {
  ChevronDown, ChevronUp, X, Lock,
  CheckCircle, AlertCircle, Clock, Loader2,
} from 'lucide-react';
import type { DownloadJobResponse, PJEDownloadProgress, PJEJobStatus } from './types';
import { isJobActive, STATUS_CONFIG } from './types';

interface Props {
  job: DownloadJobResponse;
  progresso?: PJEDownloadProgress;
  expandido: boolean;
  onAlternarExpansao: () => void;
  onCancelar: () => void;
  onAbrir2FA: () => void;
}

function StatusIcon({ status }: { status: PJEJobStatus }) {
  switch (status) {
    case 'completed': return <CheckCircle size={14} className="text-emerald-600" />;
    case 'failed': return <AlertCircle size={14} className="text-red-600" />;
    case 'cancelled': return <X size={14} className="text-slate-400" />;
    case 'awaiting_2fa': return <Lock size={14} className="text-amber-600" />;
    default: return isJobActive(status) ? <Loader2 size={14} className="animate-spin text-blue-600" /> : <Clock size={14} className="text-slate-400" />;
  }
}

export function CardJob({ job, progresso, expandido, onAlternarExpansao, onCancelar, onAbrir2FA }: Props) {
  const ativo = isJobActive(job.status);
  const cfg = STATUS_CONFIG[job.status];
  const pct = progresso?.progress ?? job.progress ?? 0;

  return (
    <div className="border-2 border-slate-200 text-sm">
      <button type="button" onClick={onAlternarExpansao}
        className="w-full p-3 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors">
        <StatusIcon status={job.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-500">{job.id.slice(0, 8)}</span>
            <span className={`px-1.5 py-0.5 text-[10px] font-bold ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
          </div>
          <p className="text-xs text-slate-600 truncate mt-0.5">{progresso?.message || `Modo: ${job.mode}`}</p>
        </div>
        {expandido ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {ativo && (
        <div className="px-3 pb-2">
          <div className="w-full h-1.5 bg-slate-100 overflow-hidden">
            <div className="h-full bg-slate-900 transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-slate-400">{pct}%</span>
            <span className="text-[10px] text-slate-400">{job.successCount}/{job.totalProcesses || '?'}</span>
          </div>
        </div>
      )}

      {expandido && (
        <div className="px-3 pb-3 border-t border-slate-100 pt-2 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-slate-50">
              <div className="text-lg font-bold text-slate-900">{job.totalProcesses}</div>
              <div className="text-[10px] text-slate-500">Total</div>
            </div>
            <div className="p-2 bg-emerald-50">
              <div className="text-lg font-bold text-emerald-700">{job.successCount}</div>
              <div className="text-[10px] text-emerald-600">Sucesso</div>
            </div>
            <div className="p-2 bg-red-50">
              <div className="text-lg font-bold text-red-700">{job.failureCount}</div>
              <div className="text-[10px] text-red-600">Falhas</div>
            </div>
          </div>

          {job.errors && job.errors.length > 0 && (
            <div className="max-h-24 overflow-y-auto">
              {job.errors.slice(0, 5).map((err, i) => (
                <div key={i} className="text-[10px] text-red-600 py-0.5 truncate">
                  {err.processNumber && <span className="font-mono">{err.processNumber}: </span>}
                  {err.message}
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {job.status === 'awaiting_2fa' && (
              <button type="button" onClick={onAbrir2FA} className="flex-1 px-2 py-1.5 text-xs font-bold bg-amber-100 text-amber-800 hover:bg-amber-200">Inserir código 2FA</button>
            )}
            {ativo && (
              <button type="button" onClick={onCancelar} className="flex-1 px-2 py-1.5 text-xs font-bold border-2 border-red-200 text-red-600 hover:bg-red-50">Cancelar</button>
            )}
          </div>
          <div className="text-[10px] text-slate-400">Criado: {new Date(job.createdAt).toLocaleString('pt-BR')}</div>
        </div>
      )}
    </div>
  );
}
