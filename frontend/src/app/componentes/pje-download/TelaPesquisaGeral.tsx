'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search, Download, FileSpreadsheet, Loader2, AlertCircle,
  CheckCircle, X, HardDrive, FileArchive,
} from 'lucide-react';
import type { PerfilPJE, SearchCriteria, SearchFormOptions } from './types';
import { FormularioPesquisa, nomePartePendente, nomeAdvogadoPendente, temAlgumCriterio } from './FormularioPesquisa';
import { obterOpcoesPesquisa } from './api-pesquisa';
import { FileSystemManager } from '../../lib/filesystem-manager';
import { DownloadManager, type DownloadProgress, type DownloadManagerParams } from '../../lib/download-manager';
import { PlanilhaPesquisaManager, type PesquisaProgress } from '../../lib/planilha-pesquisa';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

type Acao = 'download' | 'planilha';

interface TelaPesquisaGeralProps {
  perfil: PerfilPJE;
  sessionId: string;
}

const OPCOES_VAZIAS: SearchFormOptions = { ufOab: [], jurisdicoes: [], orgaosJulgadores: [] };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TelaPesquisaGeral({ perfil, sessionId }: TelaPesquisaGeralProps) {
  const [acao, setAcao] = useState<Acao>('planilha');
  const [criteria, setCriteria] = useState<SearchCriteria>({});
  const [opcoes, setOpcoes] = useState<SearchFormOptions>(OPCOES_VAZIAS);
  const [carregandoOpcoes, setCarregandoOpcoes] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [planilhaProgress, setPlanilhaProgress] = useState<PesquisaProgress | null>(null);

  const downloadRef = useRef<DownloadManager | null>(null);
  const planilhaRef = useRef<PlanilhaPesquisaManager | null>(null);

  const fsApiSupported = typeof window !== 'undefined' && FileSystemManager?.isSupported?.();

  useEffect(() => {
    let ativo = true;
    setCarregandoOpcoes(true);
    obterOpcoesPesquisa(sessionId)
      .then((data) => { if (ativo) setOpcoes(data || OPCOES_VAZIAS); })
      .catch(() => { if (ativo) setOpcoes(OPCOES_VAZIAS); })
      .finally(() => { if (ativo) setCarregandoOpcoes(false); });
    return () => { ativo = false; };
  }, [sessionId]);

  const downloadAtivo = downloadProgress && !['done', 'error', 'cancelled'].includes(downloadProgress.phase);
  const planilhaAtiva = planilhaProgress && !['done', 'error', 'cancelled'].includes(planilhaProgress.phase);
  const ocupado = !!(downloadAtivo || planilhaAtiva);

  const bloqueado = useMemo(() => {
    if (nomePartePendente(criteria)) return 'A pesquisa por Nome da Parte deve conter pelo menos duas palavras.';
    if (nomeAdvogadoPendente(criteria)) return 'A pesquisa por Nome do Representante deve conter pelo menos duas palavras.';
    if (!temAlgumCriterio(criteria)) return 'Informe ao menos um critério de pesquisa.';
    return null;
  }, [criteria]);

  const podeSubmit = !bloqueado && !ocupado;

  const handleDownload = useCallback(async () => {
    setErro(null);
    setDownloadProgress(null);
    const manager = new DownloadManager();
    downloadRef.current = manager;
    const params: DownloadManagerParams = {
      apiBase: API_BASE,
      sessionId,
      mode: 'by_search',
      searchCriteria: criteria,
    };
    try {
      await manager.execute(params, (p) => setDownloadProgress({ ...p }));
    } catch (err: any) {
      setErro(err?.message || 'Erro inesperado');
    }
  }, [criteria, sessionId]);

  const handlePlanilha = useCallback(async () => {
    setErro(null);
    setPlanilhaProgress(null);
    const manager = new PlanilhaPesquisaManager();
    planilhaRef.current = manager;
    try {
      await manager.execute({ apiBase: API_BASE, sessionId, criteria }, (p) => setPlanilhaProgress({ ...p }));
    } catch (err: any) {
      setErro(err?.message || 'Erro inesperado');
    }
  }, [criteria, sessionId]);

  const handleSubmit = useCallback(() => {
    if (!podeSubmit) return;
    if (acao === 'download') handleDownload();
    else handlePlanilha();
  }, [podeSubmit, acao, handleDownload, handlePlanilha]);

  const handleCancelar = useCallback(() => {
    downloadRef.current?.cancel();
    planilhaRef.current?.cancel();
  }, []);

  const dpct = downloadProgress
    ? (downloadProgress.totalRequests || downloadProgress.totalProcesses) > 0
      ? Math.round(((downloadProgress.successCount + downloadProgress.failedCount + downloadProgress.notAvailableCount) / (downloadProgress.totalRequests || downloadProgress.totalProcesses)) * 100)
      : 0
    : 0;

  const ppct = planilhaProgress && planilhaProgress.total > 0
    ? Math.round((planilhaProgress.collected / planilhaProgress.total) * 100)
    : 0;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <span className="num-badge">1</span>
        <span className="eyebrow">O que deseja fazer</span>
      </div>

      <div className="mb-8 grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setAcao('planilha')}
          disabled={ocupado}
          className={`pick group p-4 ${acao === 'planilha' ? 'pick-on' : ''}`}
        >
          <span className={`mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${acao === 'planilha' ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
            <FileSpreadsheet size={18} />
          </span>
          <span className="block text-sm font-semibold text-ink">Gerar planilha de resultados</span>
          <span className="mt-0.5 block text-xs text-slate-500">Inclui a coluna “Nó(s) atual(is)”.</span>
        </button>

        <button
          type="button"
          onClick={() => setAcao('download')}
          disabled={ocupado}
          className={`pick group p-4 ${acao === 'download' ? 'pick-on' : ''}`}
        >
          <span className={`mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${acao === 'download' ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-700'}`}>
            <Download size={18} />
          </span>
          <span className="block text-sm font-semibold text-ink">Baixar processos</span>
          <span className="mt-0.5 block text-xs text-slate-500">PDFs dos processos encontrados.</span>
        </button>
      </div>

      <div className="mb-6 border-b border-slate-100 pb-2">
        <div className="mb-4 flex items-center gap-2">
          <span className="num-badge">2</span>
          <span className="eyebrow">Critérios de pesquisa</span>
        </div>
        <FormularioPesquisa
          criteria={criteria}
          onChange={setCriteria}
          opcoes={opcoes}
          carregandoOpcoes={carregandoOpcoes}
          desabilitado={ocupado}
        />
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
          <span>{erro}</span>
        </div>
      )}

      {acao === 'download' && downloadProgress && (
        <div className={`mb-6 rounded-2xl border p-4 ${
          downloadProgress.phase === 'done' ? 'border-emerald-200 bg-emerald-50' :
          ['error', 'cancelled'].includes(downloadProgress.phase) ? 'border-red-200 bg-red-50' :
          'border-navy-200 bg-navy-50'
        }`}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {downloadProgress.phase === 'done' ? <CheckCircle size={16} className="text-emerald-600" /> :
               ['error', 'cancelled'].includes(downloadProgress.phase) ? <AlertCircle size={16} className="text-red-600" /> :
               <Loader2 size={16} className="animate-spin text-navy-600" />}
              <span className="truncate text-sm font-semibold text-ink">{downloadProgress.message}</span>
            </div>
            {downloadAtivo && (
              <button type="button" onClick={handleCancelar} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800">
                <X size={14} /> Cancelar
              </button>
            )}
          </div>
          {downloadAtivo && (downloadProgress.totalRequests || downloadProgress.totalProcesses) > 0 && (
            <>
              <div className="progress-track mb-1"><div className="progress-bar bg-navy-700" style={{ width: `${dpct}%` }} /></div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{downloadProgress.successCount + downloadProgress.failedCount}/{downloadProgress.totalRequests || downloadProgress.totalProcesses}</span>
                <span>{formatBytes(downloadProgress.bytesDownloaded)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {acao === 'planilha' && planilhaProgress && (
        <div className={`mb-6 rounded-2xl border p-4 ${
          planilhaProgress.phase === 'done' ? 'border-emerald-200 bg-emerald-50' :
          ['error', 'cancelled'].includes(planilhaProgress.phase) ? 'border-red-200 bg-red-50' :
          'border-emerald-200 bg-emerald-50/60'
        }`}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {planilhaProgress.phase === 'done' ? <CheckCircle size={16} className="text-emerald-600" /> :
               ['error', 'cancelled'].includes(planilhaProgress.phase) ? <AlertCircle size={16} className="text-red-600" /> :
               <Loader2 size={16} className="animate-spin text-emerald-600" />}
              <span className="truncate text-sm font-semibold text-ink">{planilhaProgress.message}</span>
            </div>
            {planilhaAtiva && (
              <button type="button" onClick={handleCancelar} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800">
                <X size={14} /> Cancelar
              </button>
            )}
          </div>
          {planilhaAtiva && planilhaProgress.total > 0 && (
            <>
              <div className="progress-track mb-1"><div className="progress-bar bg-emerald-600" style={{ width: `${ppct}%` }} /></div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{planilhaProgress.collected}/{planilhaProgress.total} processos</span>
                <span>{ppct}%</span>
              </div>
            </>
          )}
        </div>
      )}

      {acao === 'download' && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-500">
          {fsApiSupported
            ? <><HardDrive size={13} /> Os PDFs serão salvos direto no seu computador.</>
            : <><FileArchive size={13} /> Os PDFs serão empacotados em um ZIP para download.</>}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!podeSubmit}
        className={`btn w-full py-3.5 text-sm ${podeSubmit ? (acao === 'planilha' ? 'btn-emerald' : 'btn-primary') : 'cursor-not-allowed bg-slate-200 text-slate-400'}`}
      >
        {ocupado ? <Loader2 size={16} className="animate-spin" /> : acao === 'planilha' ? <FileSpreadsheet size={16} /> : <Download size={16} />}
        {ocupado ? 'Processando…' : acao === 'planilha' ? 'Gerar planilha' : 'Baixar processos'}
      </button>

      {bloqueado && !ocupado && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <AlertCircle size={12} className="text-slate-400" />
          <p className="text-xs text-slate-400">{bloqueado}</p>
        </div>
      )}

      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
        <Search size={12} /> Perfil: {perfil.nome}
      </p>
    </div>
  );
}
