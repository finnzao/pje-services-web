'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Search, Landmark, UserCog, LogOut,
  FileArchive, AlertCircle, Loader2, CheckCircle, X,
} from 'lucide-react';
import type { PerfilPJE, UsuarioPJE, SearchCriteria } from './types';
import { FormularioPesquisa } from './FormularioPesquisa';
import { SeletorTipoDocumento } from './SeletorTipoDocumento';
import { ProfileBadge } from './ProfileBadge';
import { ResultadoFinal } from './ResultadoFinal';
import { DownloadManager, type DownloadProgress, type DownloadManagerParams } from '../../lib/download-manager';
import { API_BASE } from '../../lib/api-client';

interface TelaPesquisaGeralProps {
  sessionId: string;
  perfil: PerfilPJE;
  usuario?: UsuarioPJE;
  onVoltar: () => void;
  onMudarPerfil: () => void;
  onLogout: () => void;
}

type ResultStatus = 'success' | 'partial' | 'failed' | 'cancelled';
interface ResultState {
  status: ResultStatus;
  titulo: string;
  mensagem: string;
  resumo: { total: number; sucesso: number; falhas: number; notAvailable?: number; bytesTotal?: number };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TITULO_POR_STATUS: Record<ResultStatus, string> = {
  success: 'Download concluído com sucesso!',
  partial: 'Download concluído parcialmente',
  failed: 'Falha no download',
  cancelled: 'Pesquisa cancelada',
};

export function TelaPesquisaGeral({
  sessionId, perfil, usuario, onVoltar, onMudarPerfil, onLogout,
}: TelaPesquisaGeralProps) {
  const [criterios, setCriterios] = useState<SearchCriteria>({});
  const [tiposSelecionados, setTiposSelecionados] = useState<string[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [resultado, setResultado] = useState<ResultState | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const managerRef = useRef<DownloadManager | null>(null);

  const temCriterio = useMemo(
    () => Object.values(criterios).some((v) => typeof v === 'string' && v.trim().length > 0),
    [criterios],
  );

  const isActive = !!progress && !['done', 'error', 'cancelled'].includes(progress.phase);
  const numTipos = tiposSelecionados.filter((t) => t && t !== 'Selecione').length;

  const pct = progress && (progress.totalRequests || progress.totalProcesses) > 0
    ? Math.round(((progress.successCount + progress.failedCount + progress.notAvailableCount) /
        (progress.totalRequests || progress.totalProcesses)) * 100)
    : 0;

  const handleBuscar = useCallback(async () => {
    if (!temCriterio) return;
    setErro(null);
    setResultado(null);
    setProgress(null);

    const manager = new DownloadManager();
    managerRef.current = manager;

    const params: DownloadManagerParams = {
      apiBase: API_BASE,
      sessionId,
      mode: 'by_search',
      searchCriteria: criterios,
      forceZip: true,
      documentTypes: tiposSelecionados.length > 0 ? tiposSelecionados : undefined,
    };

    let final: DownloadProgress | null = null;
    try {
      await manager.execute(params, (p) => { final = { ...p }; setProgress(final); });
    } catch (err: any) {
      setErro(err?.message || 'Erro inesperado');
      return;
    }

    if (final) {
      const fp = final as DownloadProgress;
      const status: ResultStatus =
        fp.phase === 'cancelled' ? 'cancelled'
        : fp.phase === 'error' ? 'failed'
        : fp.failedCount === 0 ? 'success'
        : fp.successCount === 0 ? 'failed'
        : 'partial';
      setResultado({
        status,
        titulo: TITULO_POR_STATUS[status],
        mensagem: fp.message,
        resumo: {
          total: fp.totalRequests || fp.totalProcesses,
          sucesso: fp.successCount,
          falhas: fp.failedCount,
          notAvailable: fp.notAvailableCount,
          bytesTotal: fp.bytesDownloaded,
        },
      });
    }
  }, [temCriterio, criterios, tiposSelecionados, sessionId]);

  const handleCancelar = useCallback(() => { managerRef.current?.cancel(); }, []);

  const handleNovaPesquisa = useCallback(() => {
    managerRef.current?.cancel();
    managerRef.current = null;
    setCriterios({});
    setTiposSelecionados([]);
    setProgress(null);
    setResultado(null);
    setErro(null);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-gradient-to-r from-navy-900 via-navy-800 to-navy-700 text-white shadow-lg shadow-navy-900/20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3.5">
            <button
              type="button" onClick={onVoltar} disabled={isActive}
              title={isActive ? 'Aguarde a conclusão' : 'Voltar aos serviços'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/90 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft size={18} />
            </button>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-brass-300 ring-1 ring-white/15 backdrop-blur">
              <Search size={20} />
            </span>
            <div className="leading-tight">
              <h1 className="font-display text-xl font-semibold tracking-tight text-white">Pesquisa Geral de Processos</h1>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-navy-200">PJE · TJBA</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {usuario && <span className="mr-1 hidden text-xs text-navy-200 sm:inline">{usuario.nomeUsuario}</span>}
            {!isActive && (
              <button type="button" onClick={onMudarPerfil}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 transition-colors hover:bg-white/15">
                <UserCog size={14} /> <span className="hidden sm:inline">Perfil</span>
              </button>
            )}
            <button type="button" onClick={onLogout} disabled={isActive}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 transition-colors hover:border-red-300/40 hover:bg-red-500/15 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40">
              <LogOut size={14} /> <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
        <div className="h-[3px] w-full bg-gradient-to-r from-brass-400/0 via-brass-400/70 to-brass-400/0" />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="surface p-6 sm:p-7 animate-rise">
          {!resultado && (
            <div className="mb-6 border-b border-slate-100 pb-4">
              <ProfileBadge perfil={perfil} />
            </div>
          )}

          {resultado ? (
            <ResultadoFinal
              status={resultado.status}
              titulo={resultado.titulo}
              mensagem={resultado.mensagem}
              resumo={resultado.resumo}
              tipoServico="processos"
              onNovaTarefa={handleNovaPesquisa}
              onMudarPerfil={onMudarPerfil}
              onLogout={onLogout}
            />
          ) : (
            <>
              {erro && (
                <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
                  <span>{erro}</span>
                </div>
              )}

              {progress && (
                <div className={`mb-6 rounded-2xl border p-4 animate-fade ${
                  progress.phase === 'done' ? 'border-emerald-200 bg-emerald-50'
                  : progress.phase === 'error' || progress.phase === 'cancelled' ? 'border-red-200 bg-red-50'
                  : 'border-navy-200 bg-navy-50'
                }`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {progress.phase === 'done' ? <CheckCircle size={16} className="text-emerald-600" />
                        : progress.phase === 'error' || progress.phase === 'cancelled' ? <AlertCircle size={16} className="text-red-600" />
                        : <Loader2 size={16} className="animate-spin text-navy-600" />}
                      <span className="truncate text-sm font-semibold text-ink">{progress.message}</span>
                    </div>
                    {isActive && (
                      <button type="button" onClick={handleCancelar} className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800">
                        <X size={14} /> Cancelar
                      </button>
                    )}
                  </div>

                  {isActive && (progress.totalRequests || progress.totalProcesses) > 0 && (
                    <>
                      <div className="progress-track mb-1"><div className="progress-bar bg-navy-700" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>{progress.successCount + progress.failedCount}/{progress.totalRequests || progress.totalProcesses}</span>
                        <span>{formatBytes(progress.bytesDownloaded)}</span>
                      </div>
                    </>
                  )}

                  {progress.files.length > 0 && (
                    <div className="scroll-area mt-3 max-h-32 overflow-y-auto">
                      {progress.files.slice(-8).reverse().map((f, i) => (
                        <div key={`${f.name}-${i}`} className="flex items-center gap-2 py-0.5 text-xs">
                          {f.status === 'ok' && <CheckCircle size={11} className="text-emerald-500" />}
                          {f.status === 'downloading' && <Loader2 size={11} className="animate-spin text-navy-500" />}
                          {f.status === 'error' && <X size={11} className="text-red-500" />}
                          {f.status === 'not_available' && <AlertCircle size={11} className="text-brass-500" />}
                          <span className={`truncate ${f.status === 'error' ? 'text-red-600' : f.status === 'not_available' ? 'text-brass-600' : 'text-slate-600'}`}>{f.name}</span>
                          {f.size > 0 && <span className="flex-shrink-0 text-slate-400">{formatBytes(f.size)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!isActive && (
                <div className="space-y-8">
                  <FormularioPesquisa criterios={criterios} onChange={setCriterios} />

                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="num-badge">2</span>
                      <span className="eyebrow">Tipos de documento</span>
                    </div>
                    <SeletorTipoDocumento selecionados={tiposSelecionados} onChange={setTiposSelecionados} />
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-500">
                    <FileArchive size={13} /> Todos os processos encontrados serão entregues em um arquivo ZIP.
                  </div>

                  <div className="sticky bottom-0 -mx-6 border-t border-slate-200 bg-white/85 px-6 py-4 backdrop-blur-md sm:-mx-7 sm:px-7">
                    <button
                      type="button" onClick={handleBuscar} disabled={!temCriterio}
                      className={`btn w-full py-3.5 text-sm ${temCriterio ? 'btn-primary' : 'cursor-not-allowed bg-slate-200 text-slate-400'}`}
                    >
                      <Search size={16} />
                      {`Pesquisar e baixar resultados${numTipos > 0 ? ` × ${numTipos} tipo(s)` : ''} (ZIP)`}
                    </button>
                    {!temCriterio && (
                      <div className="mt-2 flex items-center justify-center gap-1.5">
                        <AlertCircle size={12} className="text-slate-400" />
                        <p className="text-xs text-slate-400">Preencha ao menos um critério de pesquisa</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200/70 py-6">
        <p className="text-center text-xs text-slate-400">Sistema interno de apoio ao PJE/TJBA · {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}
