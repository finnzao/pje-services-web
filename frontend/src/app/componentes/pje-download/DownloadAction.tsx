'use client';

import React from 'react';
import { Download, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import type { ServicoAtivo, PJEDownloadMode } from './types';

interface DownloadActionProps {
  servico: ServicoAtivo | null;
  modo: PJEDownloadMode;
  numTarefas: number;
  numEtiquetas: number;
  numerosProcesso: string[];
  tiposSelecionados?: string[];
  carregando: boolean;
  fsApiSupported?: boolean;
  totalProcessos?: number;
  onClick: () => void;
}

function validarFluxo(
  servico: ServicoAtivo | null, modo: PJEDownloadMode,
  numTarefas: number, numEtiquetas: number, numerosProcesso: string[],
): { valido: boolean; mensagem: string } {
  if (!servico) return { valido: false, mensagem: 'Selecione um serviço para continuar' };
  if (modo === 'by_task' && numTarefas === 0) return { valido: false, mensagem: 'Selecione ao menos uma tarefa para continuar' };
  if (modo === 'by_tag' && numEtiquetas === 0) return { valido: false, mensagem: 'Selecione ao menos uma etiqueta para continuar' };
  if (modo === 'by_number' && numerosProcesso.length === 0) return { valido: false, mensagem: 'Cole ao menos um número CNJ válido' };
  return { valido: true, mensagem: '' };
}

export function DownloadAction({
  servico, modo, numTarefas, numEtiquetas,
  numerosProcesso, tiposSelecionados = [],
  carregando, fsApiSupported = false, totalProcessos = 0, onClick,
}: DownloadActionProps) {
  const { valido, mensagem } = validarFluxo(servico, modo, numTarefas, numEtiquetas, numerosProcesso);
  const habilitado = valido && !carregando;
  const isAdvogados = servico === 'advogados';
  const numTipos = tiposSelecionados.filter((s) => s && s !== 'Selecione').length;

  const obterLabel = (): string => {
    if (carregando) return 'Processando…';
    if (!valido) return isAdvogados ? 'Gerar planilha' : 'Baixar processos';
    if (isAdvogados) return 'Gerar planilha de advogados';
    const sufixo = numTipos > 0 ? ` × ${numTipos} tipo(s)` : '';
    if (modo === 'by_task' && numTarefas > 0) return `Baixar ${totalProcessos} processo(s) de ${numTarefas} tarefa(s)${sufixo}`;
    if (modo === 'by_tag' && numEtiquetas > 0) return `Baixar processos de ${numEtiquetas} etiqueta(s)${sufixo}`;
    if (modo === 'by_number' && numerosProcesso.length > 0) return `Baixar ${numerosProcesso.length} processo(s)${sufixo}`;
    return fsApiSupported ? 'Escolher pasta e baixar' : 'Baixar como ZIP';
  };

  const Icone = isAdvogados ? FileSpreadsheet : Download;

  return (
    <div className="sticky bottom-0 -mx-6 mt-6 border-t border-slate-200 bg-white/85 px-6 py-4 backdrop-blur-md">
      <button
        type="button"
        onClick={onClick}
        disabled={!habilitado}
        className={`btn w-full py-3.5 text-sm ${habilitado ? (isAdvogados ? 'btn-emerald' : 'btn-primary') : 'cursor-not-allowed bg-slate-200 text-slate-400'}`}
      >
        {carregando ? <Loader2 size={16} className="animate-spin" /> : <Icone size={16} />}
        {obterLabel()}
      </button>

      {!valido && !carregando && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <AlertCircle size={12} className="text-slate-400" />
          <p className="text-xs text-slate-400">{mensagem}</p>
        </div>
      )}
    </div>
  );
}
