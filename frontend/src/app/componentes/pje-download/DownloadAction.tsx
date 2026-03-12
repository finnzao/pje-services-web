'use client';

import React from 'react';
import { Download, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import type { ServicoAtivo, PJEDownloadMode } from './types';

interface DownloadActionProps {
  servico: ServicoAtivo | null;
  modo: PJEDownloadMode;
  tarefaSelecionada: string;
  etiquetaSelecionada: number | null;
  numerosProcesso: string[];
  carregando: boolean;
  fsApiSupported?: boolean;
  totalProcessos?: number;
  onClick: () => void;
}

// Valida se todas as etapas foram preenchidas e retorna mensagem de orientação
function validarFluxo(
  servico: ServicoAtivo | null,
  modo: PJEDownloadMode,
  tarefaSelecionada: string,
  etiquetaSelecionada: number | null,
  numerosProcesso: string[],
): { valido: boolean; mensagem: string } {
  if (!servico) {
    return { valido: false, mensagem: 'Selecione um serviço para continuar' };
  }
  if (modo === 'by_task' && !tarefaSelecionada) {
    return { valido: false, mensagem: 'Selecione uma tarefa para continuar' };
  }
  if (modo === 'by_tag' && !etiquetaSelecionada) {
    return { valido: false, mensagem: 'Selecione uma etiqueta para continuar' };
  }
  if (modo === 'by_number' && numerosProcesso.length === 0) {
    return { valido: false, mensagem: 'Informe pelo menos um número de processo' };
  }
  return { valido: true, mensagem: '' };
}

export function DownloadAction({
  servico,
  modo,
  tarefaSelecionada,
  etiquetaSelecionada,
  numerosProcesso,
  carregando,
  fsApiSupported = false,
  totalProcessos = 0,
  onClick,
}: DownloadActionProps) {
  const { valido, mensagem } = validarFluxo(
    servico, modo, tarefaSelecionada, etiquetaSelecionada, numerosProcesso,
  );

  const habilitado = valido && !carregando;
  const isAdvogados = servico === 'advogados';

  // Label dinâmico do botão
  const obterLabel = (): string => {
    if (carregando) return 'Processando...';
    if (!valido) return isAdvogados ? 'Gerar Planilha' : 'Baixar Processos';

    if (isAdvogados) return 'Gerar Planilha de Advogados';

    if (modo === 'by_task' && tarefaSelecionada) {
      return `Baixar ${totalProcessos} processo(s) de "${tarefaSelecionada}"`;
    }
    if (modo === 'by_tag' && etiquetaSelecionada) {
      return 'Baixar processos da etiqueta';
    }
    if (modo === 'by_number') {
      return `Baixar ${numerosProcesso.length} processo(s)`;
    }
    return fsApiSupported ? 'Escolher pasta e baixar' : 'Baixar como ZIP';
  };

  const IconeBotao = isAdvogados ? FileSpreadsheet : Download;

  return (
    <div className="sticky bottom-0 bg-white border-t-2 border-slate-200 p-4 -mx-6 mt-6">
      <button
        type="button"
        onClick={onClick}
        disabled={!habilitado}
        className={`w-full flex items-center justify-center gap-2 py-3.5 px-4 text-sm font-bold transition-all ${
          habilitado
            ? isAdvogados
              ? 'bg-emerald-700 text-white hover:bg-emerald-800'
              : 'bg-slate-900 text-white hover:bg-slate-800'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        {carregando ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <IconeBotao size={16} />
        )}
        {obterLabel()}
      </button>

      {/* Mensagem de orientação quando botão desabilitado */}
      {!valido && !carregando && (
        <div className="flex items-center justify-center gap-1.5 mt-2">
          <AlertCircle size={12} className="text-slate-400" />
          <p className="text-xs text-slate-400">{mensagem}</p>
        </div>
      )}
    </div>
  );
}
