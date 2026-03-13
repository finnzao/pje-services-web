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
  resumo?: {
    total: number;
    sucesso: number;
    falhas: number;
    bytesTotal?: number;
  };
  tipoServico: 'processos' | 'advogados';
  onNovaTarefa: () => void;
  onMudarPerfil: () => void;
  onLogout: () => void;
  /** Slot opcional para ação extra (ex: botão de download de planilha) */
  acaoExtra?: React.ReactNode;
}

const STATUS_VISUAL: Record<ResultadoStatus, {
  icone: React.ReactNode;
  corBorda: string;
  corFundo: string;
  corTexto: string;
}> = {
  success: {
    icone: <CheckCircle size={40} className="text-emerald-600" />,
    corBorda: 'border-emerald-300',
    corFundo: 'bg-emerald-50',
    corTexto: 'text-emerald-800',
  },
  partial: {
    icone: <AlertTriangle size={40} className="text-amber-600" />,
    corBorda: 'border-amber-300',
    corFundo: 'bg-amber-50',
    corTexto: 'text-amber-800',
  },
  failed: {
    icone: <XCircle size={40} className="text-red-600" />,
    corBorda: 'border-red-300',
    corFundo: 'bg-red-50',
    corTexto: 'text-red-800',
  },
  cancelled: {
    icone: <XCircle size={40} className="text-slate-500" />,
    corBorda: 'border-slate-300',
    corFundo: 'bg-slate-50',
    corTexto: 'text-slate-700',
  },
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
  const visual = STATUS_VISUAL[status];
  const IconeServico = tipoServico === 'processos' ? Download : FileSpreadsheet;

  return (
    <div className={`border-2 ${visual.corBorda} ${visual.corFundo} p-6`}>
      {/* Cabeçalho com ícone e título */}
      <div className="flex flex-col items-center text-center mb-6">
        <div className="mb-3">{visual.icone}</div>
        <h3 className={`text-lg font-bold ${visual.corTexto}`}>{titulo}</h3>
        <p className="text-sm text-slate-600 mt-1">{mensagem}</p>
      </div>

      {/* Resumo numérico */}
      {resumo && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="p-3 bg-white border border-slate-200 text-center">
            <div className="text-xl font-bold text-slate-900">{resumo.total}</div>
            <div className="text-[11px] text-slate-500 font-medium">Total</div>
          </div>
          <div className="p-3 bg-white border border-emerald-200 text-center">
            <div className="text-xl font-bold text-emerald-700">{resumo.sucesso}</div>
            <div className="text-[11px] text-emerald-600 font-medium">Sucesso</div>
          </div>
          <div className="p-3 bg-white border border-red-200 text-center">
            <div className="text-xl font-bold text-red-700">{resumo.falhas}</div>
            <div className="text-[11px] text-red-600 font-medium">Falhas</div>
          </div>
        </div>
      )}

      {resumo?.bytesTotal != null && resumo.bytesTotal > 0 && (
        <p className="text-xs text-slate-500 text-center mb-6">
          Volume total: <span className="font-semibold">{formatBytes(resumo.bytesTotal)}</span>
        </p>
      )}

      {/* Ação extra (ex: download de planilha) */}
      {acaoExtra && <div className="mb-4">{acaoExtra}</div>}

      {/* Ações principais */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={onNovaTarefa}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
        >
          <RefreshCw size={16} />
          <IconeServico size={16} />
          Iniciar nova tarefa
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onMudarPerfil}
            className="flex items-center justify-center gap-2 py-2.5 px-3 text-sm font-bold border-2 border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <UserCog size={14} />
            Mudar perfil
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center justify-center gap-2 py-2.5 px-3 text-sm font-bold border-2 border-red-200 text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut size={14} />
            Sair do PJE
          </button>
        </div>
      </div>
    </div>
  );
}
