'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileSpreadsheet, Search, User, Hash, ClipboardList, Tag,
  ArrowLeft, AlertCircle, Loader2,
} from 'lucide-react';

import type { PerfilPJE, TarefaPJE, EtiquetaPJE } from './types';
import { ListaTarefas } from './ListaTarefas';
import { ListaEtiquetas } from './ListaEtiquetas';
import { ProgressoJob } from './ProgressoJob';
import {
  gerarPlanilhaAdvogados, obterProgressoAdvogados,
  cancelarPlanilhaAdvogados, downloadPlanilha,
  type GerarPlanilhaParams,
} from './api-advogados';

type FonteProcessos = 'by_task' | 'by_tag';
type TipoFiltro = 'nome' | 'oab';

interface EtapaAdvogadosProps {
  perfil: PerfilPJE;
  tarefas: TarefaPJE[];
  tarefasFavoritas: TarefaPJE[];
  etiquetas: EtiquetaPJE[];
  credenciais: { cpf: string; password: string };
  sessionId?: string;
  onVoltar: () => void;
}

interface JobState {
  jobId: string;
  status: string;
  progress: number;
  message: string;
  totalProcesses: number;
  processedCount: number;
}

export function EtapaAdvogados({
  perfil, tarefas, tarefasFavoritas, etiquetas,
  credenciais, sessionId, onVoltar,
}: EtapaAdvogadosProps) {
  const [fonte, setFonte] = useState<FonteProcessos>('by_tag');
  const [tarefaSelecionada, setTarefaSelecionada] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [etiquetaSelecionada, setEtiquetaSelecionada] = useState<number | null>(null);
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('nome');
  const [valorFiltro, setValorFiltro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const p = await obterProgressoAdvogados(jobId);
        setJob({ jobId, status: p.status, progress: p.progress, message: p.message, totalProcesses: p.totalProcesses, processedCount: p.processedCount });
        if (['completed', 'failed', 'cancelled'].includes(p.status)) { stopPolling(); setCarregando(false); }
      } catch { /* silent */ }
    }, 3000);
  }, [stopPolling]);

  const podeSubmit = (): boolean => {
    if (carregando) return false;
    return fonte === 'by_task' ? !!tarefaSelecionada : !!etiquetaSelecionada;
  };

  const handleGerar = async () => {
    setCarregando(true);
    setErro(null);
    setJob(null);

    const params: GerarPlanilhaParams = {
      credentials: credenciais, fonte,
      pjeSessionId: sessionId, pjeProfileIndex: perfil.indice,
    };

    if (fonte === 'by_task') {
      params.taskName = tarefaSelecionada;
      params.isFavorite = isFavorite;
    } else {
      params.tagId = etiquetaSelecionada!;
      params.tagName = etiquetas.find((e) => e.id === etiquetaSelecionada)?.nomeTag;
    }

    if (valorFiltro.trim()) params.filtro = { tipo: tipoFiltro, valor: valorFiltro.trim() };

    try {
      const result = await gerarPlanilhaAdvogados(params);
      setJob({ jobId: result.jobId, status: 'listing', progress: 0, message: 'Iniciando...', totalProcesses: 0, processedCount: 0 });
      startPolling(result.jobId);
    } catch (err: any) {
      setErro(err.message || 'Erro ao iniciar geração');
      setCarregando(false);
    }
  };

  const handleCancelar = async () => {
    if (!job) return;
    try { await cancelarPlanilhaAdvogados(job.jobId); stopPolling(); setJob((p) => p ? { ...p, status: 'cancelled', message: 'Cancelado.' } : null); setCarregando(false); } catch { /* silent */ }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <button type="button" onClick={onVoltar} className="text-slate-400 hover:text-slate-700"><ArrowLeft size={16} /></button>
        <FileSpreadsheet size={20} className="text-emerald-600" />
        <h3 className="text-lg font-bold text-slate-900">Planilha de Advogados</h3>
      </div>
      <p className="text-xs text-slate-500 mb-6 ml-6">Perfil: <span className="font-semibold text-slate-700">{perfil.nome}</span></p>

      {erro && (
        <div className="mb-4 p-3 bg-red-50 border-2 border-red-200 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{erro}</p>
        </div>
      )}

      {job && (
        <div className="mb-6">
          <ProgressoJob
            status={job.status} progress={job.progress} message={job.message}
            processedCount={job.processedCount} totalProcesses={job.totalProcesses}
            onDownload={job.status === 'completed' ? () => downloadPlanilha(job.jobId) : undefined}
            onCancelar={!['completed', 'failed', 'cancelled'].includes(job.status) ? handleCancelar : undefined}
          />
        </div>
      )}

      {/* Fonte */}
      <div className="mb-6">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">Fonte dos Processos</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: 'by_tag' as FonteProcessos, icone: <Tag size={16} />, rotulo: 'Por Etiqueta' },
            { id: 'by_task' as FonteProcessos, icone: <ClipboardList size={16} />, rotulo: 'Por Tarefa' },
          ]).map((m) => (
            <button key={m.id} type="button" onClick={() => setFonte(m.id)}
              className={`p-3 border-2 text-left transition-all ${fonte === m.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="flex items-center gap-2">
                <span className={fonte === m.id ? 'text-slate-900' : 'text-slate-400'}>{m.icone}</span>
                <span className={`text-sm font-bold ${fonte === m.id ? 'text-slate-900' : 'text-slate-600'}`}>{m.rotulo}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Filtro de advogado */}
      <div className="mb-6 p-4 bg-amber-50 border-2 border-amber-200">
        <div className="flex items-center gap-2 mb-3">
          <Search size={14} className="text-amber-700" />
          <span className="text-xs font-bold text-amber-800 uppercase tracking-wide">Filtrar por Advogado (opcional)</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          {(['nome', 'oab'] as TipoFiltro[]).map((t) => (
            <button key={t} type="button" onClick={() => setTipoFiltro(t)}
              className={`px-3 py-1.5 text-xs font-bold transition-colors ${tipoFiltro === t ? 'bg-amber-700 text-white' : 'bg-white border border-amber-300 text-amber-700'}`}>
              {t === 'nome' ? <><User size={12} className="inline mr-1" />Nome</> : <><Hash size={12} className="inline mr-1" />OAB</>}
            </button>
          ))}
        </div>
        <input type="text" value={valorFiltro} onChange={(e) => setValorFiltro(e.target.value)}
          placeholder={tipoFiltro === 'nome' ? 'Ex: Felipe, Paulo...' : 'Ex: BA33407, SE6662...'}
          className="w-full px-3 py-2 border-2 border-amber-200 text-sm focus:border-amber-400 focus:outline-none bg-white" />
        <p className="text-xs text-amber-600 mt-2">
          {tipoFiltro === 'nome'
            ? 'Apenas processos com advogados cujo nome contenha o termo.'
            : 'Apenas processos com advogados cuja OAB contenha o número.'}
          {!valorFiltro.trim() && ' Deixe vazio para todos.'}
        </p>
      </div>

      {fonte === 'by_task' && (
        <div className="mb-6">
          <ListaTarefas
            tarefas={tarefas} tarefasFavoritas={tarefasFavoritas}
            tarefaSelecionada={tarefaSelecionada} isFavorite={isFavorite}
            onSelecionar={(nome, fav) => { setTarefaSelecionada(nome); setIsFavorite(fav); }}
          />
        </div>
      )}

      {fonte === 'by_tag' && (
        <div className="mb-6">
          <ListaEtiquetas etiquetas={etiquetas} selecionada={etiquetaSelecionada} onSelecionar={setEtiquetaSelecionada} />
        </div>
      )}

      <button type="button" onClick={handleGerar} disabled={!podeSubmit()}
        className={`w-full flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold transition-all ${
          podeSubmit() ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}>
        {carregando
          ? <><Loader2 size={16} className="animate-spin" /> Gerando...</>
          : <><FileSpreadsheet size={16} /> Gerar Planilha de Advogados</>}
      </button>

      {valorFiltro.trim() && (
        <p className="mt-2 text-xs text-center text-slate-500">
          Filtro: <strong>{tipoFiltro === 'nome' ? 'Nome' : 'OAB'}</strong> contém "<strong>{valorFiltro}</strong>"
        </p>
      )}
    </div>
  );
}