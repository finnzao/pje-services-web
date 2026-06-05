'use client';

import React from 'react';
import {
  CheckCircle, AlertTriangle, XCircle, RefreshCw,
  UserCog, LogOut, Download, FileSpreadsheet,
} from 'lucide-react';

type ResultadoStatus = 'success' | 'partial' | 'failed' | 'cancelled';

interface ResultadoFinalProps {
  status: ResultadoStatus;
  titulo: string;
  mensagem: string;
  resumo?: { total: number; sucesso: number; falhas: number; bytesTotal?: number };
  tipoServico: 'processos' | 'advogados';
  onNovaTarefa: () => void;
  onMudarPerfil: () => void;
  onLogout: () => void;
  acaoExtra?: React.ReactNode;
}

const VISUAL: Record<ResultadoStatus, { icone: React.ReactNode; borda: string; fundo: string; texto: string }> = {
  success:   { icone: <CheckCircle size={36} className="text-emerald-600" />, borda: 'border-emerald-200', fundo: 'bg-emerald-50', texto: 'text-emerald-800' },
  partial:   { icone: <AlertTriangle size={36} className="text-brass-500" />,  borda: 'border-brass-300',   fundo: 'bg-brass-50',   texto: 'text-brass-600' },
  failed:    { icone: <XCircle size={36} className="text-red-600" />,          borda: 'border-red-200',     fundo: 'bg-red-50',     texto: 'text-red-800' },
  cancelled: { icone: <XCircle size={36} className="text-slate-500" />,        borda: 'border-slate-300',   fundo: 'bg-slate-50',   texto: 'text-slate-700' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResultadoFinal({
  status, titulo, mensagem, resumo, tipoServico,
  onNovaTarefa, onMudarPerfil, onLogout, acaoExtra,
}: ResultadoFinalProps) {
  const v = VISUAL[status];
  const IconeServico = tipoServico === 'processos' ? Download : FileSpreadsheet;

  return (
    <div className="animate-rise">
      <div className={`rounded-2xl border ${v.borda} ${v.fundo} p-6`}>
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 animate-pop">{v.icone}</div>
          <h3 className={`font-display text-xl font-semibold ${v.texto}`}>{titulo}</h3>
          <p className="mt-1 text-sm text-slate-600">{mensagem}</p>
        </div>

        {resumo && (
          <div className="mb-5 grid grid-cols-3 gap-3">
            <Stat valor={resumo.total} rotulo="Total" tone="slate" />
            <Stat valor={resumo.sucesso} rotulo="Sucesso" tone="emerald" />
            <Stat valor={resumo.falhas} rotulo="Falhas" tone="red" />
          </div>
        )}

        {resumo?.bytesTotal != null && resumo.bytesTotal > 0 && (
          <p className="mb-5 text-center text-xs text-slate-500">
            Volume total: <span className="font-semibold">{formatBytes(resumo.bytesTotal)}</span>
          </p>
        )}

        {acaoExtra && <div className="mb-4">{acaoExtra}</div>}

        <div className="space-y-2.5">
          <button type="button" onClick={onNovaTarefa} className="btn btn-primary w-full py-3 text-sm">
            <RefreshCw size={15} /> <IconeServico size={15} /> Iniciar nova tarefa
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={onMudarPerfil} className="btn btn-ghost py-2.5 text-sm">
              <UserCog size={14} /> Mudar perfil
            </button>
            <button type="button" onClick={onLogout} className="btn btn-danger py-2.5 text-sm">
              <LogOut size={14} /> Sair do PJE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ valor, rotulo, tone }: { valor: React.ReactNode; rotulo: string; tone: 'emerald' | 'red' | 'slate' }) {
  const map = {
    emerald: 'border-emerald-200 text-emerald-700',
    red: 'border-red-200 text-red-700',
    slate: 'border-slate-200 text-slate-900',
  } as const;
  return (
    <div className={`rounded-xl border bg-white p-3 text-center ${map[tone]}`}>
      <div className="text-xl font-bold leading-none">{valor}</div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-wide opacity-70">{rotulo}</div>
    </div>
  );
}
