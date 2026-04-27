/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  AlertCircle, HardDrive, FileArchive,
  Loader2, CheckCircle, X, LogOut,
  UserCog,
} from 'lucide-react';

import { EtapaLogin } from '../../componentes/pje-download/EtapaLogin';
import { EtapaPerfil } from '../../componentes/pje-download/EtapaPerfil';
import { ServiceSelector } from '../../componentes/pje-download/ServiceSelector';
import { DownloadModeSelector } from '../../componentes/pje-download/DownloadModeSelector';
import { DownloadAction } from '../../componentes/pje-download/DownloadAction';
import { ExecutionStatus } from '../../componentes/pje-download/ExecutionStatus';
import { ProfileBadge } from '../../componentes/pje-download/ProfileBadge';
import { ListaTarefas } from '../../componentes/pje-download/ListaTarefas';
import { ListaEtiquetas } from '../../componentes/pje-download/ListaEtiquetas';
import { ProgressoJob } from '../../componentes/pje-download/ProgressoJob';
import { ResultadoFinal } from '../../componentes/pje-download/ResultadoFinal';
import { FiltrosAdvogados } from '../../componentes/pje-download/FiltrosAdvogados';

import { API_BASE, ApiError } from '../../lib/api-client';
import {
  loginPJE, enviar2FA, selecionarPerfil,
} from '../../componentes/pje-download/api';
import {
  gerarPlanilhaAdvogados, obterProgressoAdvogados,
  cancelarPlanilhaAdvogados, downloadPlanilha,
  type GerarPlanilhaParams,
} from '../../componentes/pje-download/api-advogados';

import type {
  EtapaWizard, SessaoPJE, PerfilPJE, EntradaLog,
  PJEDownloadMode, ServicoAtivo, EstadoExecucao,
  FiltroAdvogado,
} from '../../componentes/pje-download/types';
import { logger, ESTADO_EXECUCAO_INICIAL } from '../../componentes/pje-download/types';

import { FileSystemManager } from '../../lib/filesystem-manager';
import { DownloadManager, type DownloadProgress, type DownloadManagerParams } from '../../lib/download-manager';

function isSessionExpiredError(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.status === 401) return true;
    const data = err.data as any;
    if (data?.error?.code === 'SESSION_EXPIRED') return true;
  }
  return false;
}

function extrairMensagemErro(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Servidor indisponível. Verifique se a API está em execução.';
    return err.message;
  }
  if (err instanceof TypeError && err.message === 'Failed to fetch')
    return 'Não foi possível conectar ao servidor.';
  if (err instanceof Error) return err.message;
  return 'Erro desconhecido.';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let logIdCounter = 0;

function useUiLogs() {
  const [, setLogs] = useState<EntradaLog[]>([]);
  const addLog = useCallback((nivel: EntradaLog['nivel'], modulo: string, mensagem: string, dados?: unknown) => {
    const entry: EntradaLog = {
      id: ++logIdCounter,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      nivel, modulo, mensagem, dados,
    };
    setLogs((prev) => [entry, ...prev].slice(0, 200));
    logger[nivel](modulo, mensagem, dados);
  }, []);
  return { addLog };
}

interface ResultadoFinalState {
  status: 'success' | 'partial' | 'failed' | 'cancelled';
  titulo: string;
  mensagem: string;
  resumo?: { total: number; sucesso: number; falhas: number; bytesTotal?: number };
  tipoServico: 'processos' | 'advogados';
  advogadosJobId?: string;
}

export default function PaginaDownloadPJE() {
  const [etapa, setEtapa] = useState<EtapaWizard>('login');
  const [sessao, setSessao] = useState<SessaoPJE>({ autenticado: false });
  const [credenciais, setCredenciais] = useState<{ cpf: string; password: string } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [servicoAtivo, setServicoAtivo] = useState<ServicoAtivo | null>(null);
  const [modo, setModo] = useState<PJEDownloadMode>('by_task');
  const [tarefaSelecionada, setTarefaSelecionada] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [etiquetaSelecionada, setEtiquetaSelecionada] = useState<number | null>(null);

  const [execucao, setExecucao] = useState<EstadoExecucao>(ESTADO_EXECUCAO_INICIAL);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const managerRef = useRef<DownloadManager | null>(null);

  const [jobAdvogados, setJobAdvogados] = useState<{
    jobId: string; status: string; progress: number;
    message: string; totalProcesses: number; processedCount: number;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [filtrosAdv, setFiltrosAdv] = useState<FiltroAdvogado[]>([]);

  const [resultado, setResultado] = useState<ResultadoFinalState | null>(null);

  const { addLog } = useUiLogs();

  const fsApiSupported = typeof window !== 'undefined' && FileSystemManager?.isSupported?.();

  const totalProcessosTarefa = useMemo(() => {
    const lista = isFavorite ? (sessao.tarefasFavoritas || []) : (sessao.tarefas || []);
    return lista.find((t) => t.nome === tarefaSelecionada)?.quantidadePendente || 0;
  }, [sessao.tarefas, sessao.tarefasFavoritas, tarefaSelecionada, isFavorite]);

  const isDownloadActive = downloadProgress && !['done', 'error', 'cancelled'].includes(downloadProgress.phase);
  const isAdvogadosActive = jobAdvogados && !['completed', 'failed', 'cancelled'].includes(jobAdvogados.status);
  const isAnyTaskActive = !!(isDownloadActive || isAdvogadosActive);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const cancelActiveOperations = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.cancel();
      managerRef.current = null;
    }
    stopPolling();
  }, [stopPolling]);

  const resetarFormulario = useCallback(() => {
    cancelActiveOperations();
    setServicoAtivo(null);
    setModo('by_task');
    setTarefaSelecionada('');
    setIsFavorite(false);
    setEtiquetaSelecionada(null);
    setExecucao(ESTADO_EXECUCAO_INICIAL);
    setDownloadProgress(null);
    setJobAdvogados(null);
    setResultado(null);
    setErro(null);
    setFiltrosAdv([]);
  }, [cancelActiveOperations]);

  const handleNovaTarefa = useCallback(() => {
    resetarFormulario();
  }, [resetarFormulario]);

  const handleMudarPerfil = useCallback(() => {
    resetarFormulario();
    setSessao((prev) => ({
      ...prev,
      perfilSelecionado: undefined,
      tarefas: undefined,
      tarefasFavoritas: undefined,
      etiquetas: undefined,
    }));
    setEtapa('perfil');
  }, [resetarFormulario]);

  const handleLogout = useCallback(() => {
    addLog('info', 'AUTH', 'Logout — limpando toda a sessão');
    cancelActiveOperations();
    resetarFormulario();
    setSessao({ autenticado: false });
    setCredenciais(null);
    setCarregando(false);
    setEtapa('login');
  }, [addLog, cancelActiveOperations, resetarFormulario]);

  const handleLogin = useCallback(async (cpf: string, senha: string) => {
    setCarregando(true);
    setErro(null);
    addLog('info', 'AUTH', `Iniciando login para CPF ***${cpf.slice(-4)}`);
    try {
      const result = await loginPJE({ cpf, password: senha });
      if (result.needs2FA) {
        addLog('warn', 'AUTH', '2FA necessário');
        setCredenciais({ cpf, password: senha });
        setSessao((prev) => ({ ...prev, sessionId: result.sessionId }));
        setEtapa('2fa');
      } else if (result.user) {
        addLog('success', 'AUTH', `Login OK — ${result.user.nomeUsuario}`);
        setSessao({ autenticado: true, sessionId: result.sessionId, usuario: result.user, perfis: result.profiles || [] });
        setCredenciais({ cpf, password: senha });
        setEtapa(result.profiles?.length ? 'perfil' : 'download');
      } else {
        setErro('Falha na autenticação.');
      }
    } catch (err: any) {
      setErro(extrairMensagemErro(err));
    } finally {
      setCarregando(false);
    }
  }, [addLog]);

  const handleEnviar2FA = useCallback(async (codigo: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const sid = sessao.sessionId || 'unknown';
      const result = await enviar2FA(sid, codigo);
      if (result.user) {
        addLog('success', '2FA', `Verificado — ${result.user.nomeUsuario}`);
        setSessao({ autenticado: true, sessionId: result.sessionId || sid, usuario: result.user, perfis: result.profiles || [] });
        setEtapa(result.profiles?.length ? 'perfil' : 'download');
      } else if (result.needs2FA) {
        setErro('Código inválido ou expirado.');
      } else {
        setErro('Resposta inesperada.');
      }
    } catch (err: any) {
      setErro(extrairMensagemErro(err));
    } finally {
      setCarregando(false);
    }
  }, [addLog, sessao.sessionId]);

  const handleSelecionarPerfil = useCallback(async (perfil: PerfilPJE) => {
    setCarregando(true);
    setErro(null);
    addLog('info', 'PERFIL', `Selecionando: "${perfil.nome}"`);
    try {
      const sid = sessao.sessionId;
      if (!sid) { handleLogout(); return; }
      const result = await selecionarPerfil(sid, perfil.indice);
      if (result.tasks) {
        addLog('success', 'PERFIL', `OK — ${result.tasks.length} tarefas`);
        setSessao((prev) => ({
          ...prev, perfilSelecionado: perfil,
          tarefas: result.tasks, tarefasFavoritas: result.favoriteTasks, etiquetas: result.tags,
        }));
        setEtapa('download');
      } else {
        setErro('Falha ao selecionar perfil.');
      }
    } catch (err: any) {
      if (isSessionExpiredError(err)) { handleLogout(); return; }
      setErro(extrairMensagemErro(err));
    } finally {
      setCarregando(false);
    }
  }, [addLog, sessao.sessionId, handleLogout]);

  const handleDownloadProcessos = useCallback(async () => {
    setErro(null);
    setDownloadProgress(null);
    setResultado(null);
    setExecucao({ ...ESTADO_EXECUCAO_INICIAL, isDownloading: true, downloadStatus: 'listing', downloadMessage: 'Iniciando download...' });

    const manager = new DownloadManager();
    managerRef.current = manager;

    const params: DownloadManagerParams = {
      apiBase: API_BASE,
      sessionId: sessao.sessionId || '',
      mode: modo,
    };

    if (modo === 'by_task') {
      params.taskName = tarefaSelecionada;
      params.isFavorite = isFavorite;
    } else if (modo === 'by_tag') {
      params.tagId = etiquetaSelecionada!;
      const etq = (sessao.etiquetas || []).find((e) => e.id === etiquetaSelecionada);
      params.tagName = etq?.nomeTag;
    }

    let finalProgress: DownloadProgress | null = null;

    try {
      await manager.execute(params, (p) => {
        finalProgress = { ...p };
        setDownloadProgress(finalProgress);
        setExecucao({
          isDownloading: !['done', 'error', 'cancelled'].includes(p.phase),
          downloadProgress: p.totalProcesses > 0
            ? Math.round(((p.successCount + p.failedCount) / p.totalProcesses) * 100)
            : 0,
          currentProcess: p.currentProcess || '',
          totalProcesses: p.totalProcesses,
          completedProcesses: p.successCount,
          failedProcesses: p.failedCount,
          downloadStatus: p.phase === 'done' ? 'completed' : p.phase === 'error' ? 'failed' : p.phase === 'cancelled' ? 'cancelled' : 'downloading',
          downloadMessage: p.message,
          bytesDownloaded: p.bytesDownloaded,
        });
      });
    } catch (err: any) {
      setErro(err.message || 'Erro inesperado');
      setExecucao((prev) => ({ ...prev, isDownloading: false, downloadStatus: 'failed', downloadMessage: err.message || 'Erro' }));
    }

    if (finalProgress) {
      const fp = finalProgress as DownloadProgress;
      const statusMap: Record<string, ResultadoFinalState['status']> = {
        done: fp.failedCount === 0 ? 'success' : fp.successCount === 0 ? 'failed' : 'partial',
        error: 'failed',
        cancelled: 'cancelled',
      };
      const st = statusMap[fp.phase] || 'failed';

      const tituloMap: Record<ResultadoFinalState['status'], string> = {
        success: 'Download concluído com sucesso!',
        partial: 'Download concluído parcialmente',
        failed: 'Falha no download',
        cancelled: 'Download cancelado',
      };

      setResultado({
        status: st,
        titulo: tituloMap[st],
        mensagem: fp.message,
        resumo: {
          total: fp.totalProcesses,
          sucesso: fp.successCount,
          falhas: fp.failedCount,
          bytesTotal: fp.bytesDownloaded,
        },
        tipoServico: 'processos',
      });
    }
  }, [modo, tarefaSelecionada, isFavorite, etiquetaSelecionada, sessao]);

  const handleCancelarDownload = useCallback(() => {
    managerRef.current?.cancel();
  }, []);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const p = await obterProgressoAdvogados(jobId);
        setJobAdvogados({ jobId, status: p.status, progress: p.progress, message: p.message, totalProcesses: p.totalProcesses, processedCount: p.processedCount });
        if (['completed', 'failed', 'cancelled'].includes(p.status)) {
          stopPolling();
          setCarregando(false);

          const statusMap: Record<string, ResultadoFinalState['status']> = {
            completed: 'success',
            failed: 'failed',
            cancelled: 'cancelled',
          };
          setResultado({
            status: statusMap[p.status] || 'failed',
            titulo: p.status === 'completed' ? 'Planilha gerada com sucesso!' : p.status === 'cancelled' ? 'Geração cancelada' : 'Falha na geração',
            mensagem: p.message,
            resumo: {
              total: p.totalProcesses,
              sucesso: p.processedCount,
              falhas: p.totalProcesses - p.processedCount,
            },
            tipoServico: 'advogados',
            advogadosJobId: p.status === 'completed' ? jobId : undefined,
          });
        }
      } catch { /* silent */ }
    }, 2500);
  }, [stopPolling]);

  const handleGerarPlanilha = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setJobAdvogados(null);
    setResultado(null);

    const params: GerarPlanilhaParams = {
      credentials: credenciais!,
      fonte: modo === 'by_task' ? 'by_task' : 'by_tag',
      pjeSessionId: sessao.sessionId,
      pjeProfileIndex: sessao.perfilSelecionado?.indice,
    };

    if (modo === 'by_task') {
      params.taskName = tarefaSelecionada;
      params.isFavorite = isFavorite;
    } else {
      params.tagId = etiquetaSelecionada!;
      params.tagName = (sessao.etiquetas || []).find((e) => e.id === etiquetaSelecionada)?.nomeTag;
    }

    if (filtrosAdv.length > 0) {
      params.filtros = filtrosAdv;
    }

    try {
      const result = await gerarPlanilhaAdvogados(params);
      setJobAdvogados({ jobId: result.jobId, status: 'listing', progress: 0, message: 'Iniciando...', totalProcesses: 0, processedCount: 0 });
      startPolling(result.jobId);
    } catch (err: any) {
      setErro(err.message || 'Erro ao iniciar geração');
      setCarregando(false);
    }
  }, [credenciais, modo, tarefaSelecionada, isFavorite, etiquetaSelecionada, sessao, filtrosAdv, startPolling]);

  const handleCancelarAdvogados = useCallback(async () => {
    if (!jobAdvogados) return;
    try {
      await cancelarPlanilhaAdvogados(jobAdvogados.jobId);
      stopPolling();
      setJobAdvogados((p) => p ? { ...p, status: 'cancelled', message: 'Cancelado.' } : null);
      setCarregando(false);
      setResultado({
        status: 'cancelled',
        titulo: 'Geração cancelada',
        mensagem: 'A geração da planilha foi cancelada pelo usuário.',
        tipoServico: 'advogados',
      });
    } catch { /* silent */ }
  }, [jobAdvogados, stopPolling]);

  const handleSubmit = useCallback(() => {
    if (servicoAtivo === 'processos') {
      handleDownloadProcessos();
    } else if (servicoAtivo === 'advogados') {
      handleGerarPlanilha();
    }
  }, [servicoAtivo, handleDownloadProcessos, handleGerarPlanilha]);

  const mostrandoDownload = etapa === 'download' && sessao.perfilSelecionado;
  const mostrandoResultado = resultado !== null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex-1 max-w-4xl mx-auto px-6 py-8 w-full">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Download PJE</h2>
            <p className="text-sm text-slate-500">PJE/TJBA — Baixe processos e gere planilhas</p>
            {sessao.perfilSelecionado && (
              <div className="mt-3">
                <ProfileBadge perfil={sessao.perfilSelecionado} />
              </div>
            )}
          </div>

          {sessao.autenticado && (
            <div className="flex items-center gap-2">
              {sessao.perfilSelecionado && !isAnyTaskActive && (
                <button
                  type="button"
                  onClick={handleMudarPerfil}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 transition-colors"
                >
                  <UserCog size={14} />
                  Mudar Perfil
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                disabled={isAnyTaskActive}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-500 disabled:hover:bg-transparent disabled:hover:border-slate-200"
                title={isAnyTaskActive ? 'Aguarde a conclusão da tarefa em andamento' : 'Sair do PJE'}
              >
                <LogOut size={14} />
                Sair
              </button>
            </div>
          )}
        </div>

        {!mostrandoDownload && (
          <div>
            {(etapa === 'login' || etapa === '2fa') && (
              <EtapaLogin
                carregando={carregando}
                erro={erro}
                aguardando2FA={etapa === '2fa'}
                onLogin={handleLogin}
                onEnviar2FA={handleEnviar2FA}
              />
            )}
            {etapa === 'perfil' && sessao.usuario && (
              <EtapaPerfil
                usuario={sessao.usuario}
                perfis={sessao.perfis || []}
                carregando={carregando}
                erro={erro}
                onSelecionar={handleSelecionarPerfil}
              />
            )}
          </div>
        )}

        {mostrandoDownload && (
          <div className="max-w-3xl bg-white border-2 border-slate-200 p-6">

            {mostrandoResultado && (
              <ResultadoFinal
                status={resultado.status}
                titulo={resultado.titulo}
                mensagem={resultado.mensagem}
                resumo={resultado.resumo}
                tipoServico={resultado.tipoServico}
                onNovaTarefa={handleNovaTarefa}
                onMudarPerfil={handleMudarPerfil}
                onLogout={handleLogout}
                acaoExtra={
                  resultado.advogadosJobId ? (
                    <BotaoDownloadPlanilha jobId={resultado.advogadosJobId} />
                  ) : undefined
                }
              />
            )}

            {!mostrandoResultado && (
              <>
                {erro && (
                  <div className="mb-6 p-3 bg-red-50 border-2 border-red-200 flex items-start gap-2">
                    <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{erro}</p>
                  </div>
                )}

                {execucao.downloadStatus !== 'idle' && servicoAtivo === 'processos' && (
                  <div className="mb-6">
                    <ExecutionStatus
                      estado={execucao}
                      onCancelar={execucao.isDownloading ? handleCancelarDownload : undefined}
                    />
                    {downloadProgress && downloadProgress.files.length > 0 && (
                      <div className="mt-2 max-h-28 overflow-y-auto border border-slate-100 p-2">
                        {downloadProgress.files.slice(-6).reverse().map((f, i) => (
                          <div key={`${f.name}-${i}`} className="flex items-center gap-2 py-0.5 text-xs">
                            {f.status === 'ok' && <CheckCircle size={10} className="text-emerald-500" />}
                            {f.status === 'downloading' && <Loader2 size={10} className="text-blue-500 animate-spin" />}
                            {f.status === 'error' && <X size={10} className="text-red-500" />}
                            <span className={`truncate ${f.status === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
                              {f.name}
                            </span>
                            {f.size > 0 && <span className="text-slate-400 flex-shrink-0">{formatBytes(f.size)}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {jobAdvogados && servicoAtivo === 'advogados' && (
                  <div className="mb-6">
                    <ProgressoJob
                      status={jobAdvogados.status}
                      progress={jobAdvogados.progress}
                      message={jobAdvogados.message}
                      processedCount={jobAdvogados.processedCount}
                      totalProcesses={jobAdvogados.totalProcesses}
                      onCancelar={isAdvogadosActive ? handleCancelarAdvogados : undefined}
                    />
                  </div>
                )}

                {!isDownloadActive && !isAdvogadosActive && (
                  <>
                    <div className="mb-8">
                      <ServiceSelector
                        servicoSelecionado={servicoAtivo}
                        onSelecionar={(s) => {
                          setServicoAtivo(s);
                          setErro(null);
                          setTarefaSelecionada('');
                          setEtiquetaSelecionada(null);
                          setFiltrosAdv([]);
                        }}
                      />
                    </div>

                    {servicoAtivo && (
                      <div className="mb-8">
                        <DownloadModeSelector
                          modoSelecionado={modo}
                          onSelecionar={(m) => {
                            setModo(m);
                            setTarefaSelecionada('');
                            setEtiquetaSelecionada(null);
                          }}
                          desabilitado={!servicoAtivo}
                        />
                      </div>
                    )}

                    {servicoAtivo && (
                      <div className="mb-4">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3 block">
                          3. {modo === 'by_task' ? 'Selecione a tarefa' : 'Selecione a etiqueta'}
                        </label>

                        {modo === 'by_task' && (
                          <>
                            <ListaTarefas
                              tarefas={sessao.tarefas || []}
                              tarefasFavoritas={sessao.tarefasFavoritas || []}
                              tarefaSelecionada={tarefaSelecionada}
                              isFavorite={isFavorite}
                              onSelecionar={(nome, fav) => { setTarefaSelecionada(nome); setIsFavorite(fav); }}
                            />
                            {tarefaSelecionada && (
                              <div className="mt-3 p-3 bg-slate-50 border border-slate-200">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-slate-900">{tarefaSelecionada}</span>
                                  <span className="text-xs font-bold text-slate-500">
                                    {totalProcessosTarefa} processo(s)
                                  </span>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {modo === 'by_tag' && (
                          <ListaEtiquetas
                            etiquetas={sessao.etiquetas || []}
                            selecionada={etiquetaSelecionada}
                            onSelecionar={setEtiquetaSelecionada}
                          />
                        )}
                      </div>
                    )}

                    {servicoAtivo === 'advogados' && (
                      <div className="mb-4">
                        <FiltrosAdvogados filtros={filtrosAdv} onChange={setFiltrosAdv} />
                      </div>
                    )}

                    {servicoAtivo === 'processos' && (
                      <div className="mb-2 px-3 py-2 bg-slate-50 border border-slate-200 flex items-center gap-2 text-xs text-slate-500">
                        {fsApiSupported
                          ? <><HardDrive size={12} /> PDFs serão salvos direto no seu computador</>
                          : <><FileArchive size={12} /> PDFs serão empacotados em ZIP para download</>}
                      </div>
                    )}

                    <DownloadAction
                      servico={servicoAtivo}
                      modo={modo}
                      tarefaSelecionada={tarefaSelecionada}
                      etiquetaSelecionada={etiquetaSelecionada}
                      numerosProcesso={[]}
                      carregando={carregando}
                      fsApiSupported={fsApiSupported}
                      totalProcessos={totalProcessosTarefa}
                      onClick={handleSubmit}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function BotaoDownloadPlanilha({ jobId }: { jobId: string }) {
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

  const handleDownload = async () => {
    setBaixando(true);
    setErroDownload(null);
    try {
      await downloadPlanilha(jobId);
    } catch (err: any) {
      setErroDownload(err.message || 'Erro ao baixar planilha');
    } finally {
      setBaixando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleDownload}
        disabled={baixando}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {baixando
          ? <><Loader2 size={16} className="animate-spin" /> Baixando...</>
          : <><CheckCircle size={16} /> Baixar Planilha</>}
      </button>
      {erroDownload && (
        <p className="mt-2 text-xs text-red-600 text-center">{erroDownload}</p>
      )}
    </>
  );
}
