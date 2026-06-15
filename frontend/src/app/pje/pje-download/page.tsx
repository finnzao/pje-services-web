'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  AlertCircle, HardDrive, FileArchive,
  Loader2, CheckCircle, X, LogOut,
  UserCog, Landmark,
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
import { ListaProcessos, normalizarCNJ } from '../../componentes/pje-download/ListaProcessos';
import { SeletorTipoDocumento } from '../../componentes/pje-download/SeletorTipoDocumento';
import { ProgressoJob } from '../../componentes/pje-download/ProgressoJob';
import { ResultadoFinal } from '../../componentes/pje-download/ResultadoFinal';
import { FiltrosAdvogados } from '../../componentes/pje-download/FiltrosAdvogados';
import { TelaPesquisaGeral } from '../../componentes/pje-download/TelaPesquisaGeral';

import { API_BASE, ApiError } from '../../lib/api-client';
import { loginPJE, enviar2FA, selecionarPerfil } from '../../componentes/pje-download/api';
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
  resumo?: { total: number; sucesso: number; falhas: number; notAvailable?: number; bytesTotal?: number };
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

  const [numerosProcessoRaw, setNumerosProcessoRaw] = useState('');
  const [tiposSelecionados, setTiposSelecionados] = useState<string[]>([]);

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

  const numerosValidados = useMemo(() => {
    return numerosProcessoRaw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => normalizarCNJ(s))
      .filter((n): n is string => Boolean(n));
  }, [numerosProcessoRaw]);

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
    if (managerRef.current) { managerRef.current.cancel(); managerRef.current = null; }
    stopPolling();
  }, [stopPolling]);

  const resetarFormulario = useCallback(() => {
    cancelActiveOperations();
    setServicoAtivo(null);
    setModo('by_task');
    setTarefaSelecionada('');
    setIsFavorite(false);
    setEtiquetaSelecionada(null);
    setNumerosProcessoRaw('');
    setTiposSelecionados([]);
    setExecucao(ESTADO_EXECUCAO_INICIAL);
    setDownloadProgress(null);
    setJobAdvogados(null);
    setResultado(null);
    setErro(null);
    setFiltrosAdv([]);
  }, [cancelActiveOperations]);

  const handleNovaTarefa = useCallback(() => { resetarFormulario(); }, [resetarFormulario]);

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
        addLog('warn', 'AUTH', `2FA necessário (tipo: ${result.twoFactorType ?? 'email'})`);
        setCredenciais({ cpf, password: senha });
        setSessao((prev) => ({ ...prev, sessionId: result.sessionId, twoFactorType: result.twoFactorType }));
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

      if (result.needs2FA && result.error) {
        addLog('warn', '2FA', `Código rejeitado: ${result.error}`);
        setSessao((prev) => ({ ...prev, sessionId: result.sessionId ?? prev.sessionId }));
        setErro(result.error);
        return;
      }

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
    setExecucao({
      ...ESTADO_EXECUCAO_INICIAL,
      isDownloading: true,
      downloadStatus: 'listing',
      downloadMessage: 'Iniciando download...',
    });

    const manager = new DownloadManager();
    managerRef.current = manager;

    const params: DownloadManagerParams = {
      apiBase: API_BASE,
      sessionId: sessao.sessionId || '',
      mode: modo,
      documentTypes: tiposSelecionados.length > 0 ? tiposSelecionados : undefined,
    };

    if (modo === 'by_task') {
      params.taskName = tarefaSelecionada;
      params.isFavorite = isFavorite;
    } else if (modo === 'by_tag') {
      params.tagId = etiquetaSelecionada!;
      const etq = (sessao.etiquetas || []).find((e) => e.id === etiquetaSelecionada);
      params.tagName = etq?.nomeTag;
    } else if (modo === 'by_number') {
      params.processNumbers = numerosValidados;
    }

    let finalProgress: DownloadProgress | null = null;

    try {
      await manager.execute(params, (p) => {
        finalProgress = { ...p };
        setDownloadProgress(finalProgress);
        const total = p.totalRequests || p.totalProcesses;
        setExecucao({
          isDownloading: !['done', 'error', 'cancelled'].includes(p.phase),
          downloadProgress: total > 0
            ? Math.round(((p.successCount + p.failedCount + p.notAvailableCount) / total) * 100)
            : 0,
          currentProcess: p.currentProcess || '',
          totalProcesses: p.totalProcesses,
          completedProcesses: p.successCount,
          failedProcesses: p.failedCount,
          notAvailableCount: p.notAvailableCount,
          downloadStatus: p.phase === 'done' ? 'completed'
            : p.phase === 'error' ? 'failed'
            : p.phase === 'cancelled' ? 'cancelled'
            : 'downloading',
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
          total: fp.totalRequests || fp.totalProcesses,
          sucesso: fp.successCount,
          falhas: fp.failedCount,
          notAvailable: fp.notAvailableCount,
          bytesTotal: fp.bytesDownloaded,
        },
        tipoServico: 'processos',
      });
    }
  }, [modo, tarefaSelecionada, isFavorite, etiquetaSelecionada, sessao, numerosValidados, tiposSelecionados]);

  const handleCancelarDownload = useCallback(() => { managerRef.current?.cancel(); }, []);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const p = await obterProgressoAdvogados(jobId);
        setJobAdvogados({
          jobId, status: p.status, progress: p.progress,
          message: p.message, totalProcesses: p.totalProcesses, processedCount: p.processedCount,
        });
        if (['completed', 'failed', 'cancelled'].includes(p.status)) {
          stopPolling();
          setCarregando(false);
          const statusMap: Record<string, ResultadoFinalState['status']> = {
            completed: 'success', failed: 'failed', cancelled: 'cancelled',
          };
          setResultado({
            status: statusMap[p.status] || 'failed',
            titulo: p.status === 'completed' ? 'Planilha gerada com sucesso!'
              : p.status === 'cancelled' ? 'Geração cancelada' : 'Falha na geração',
            mensagem: p.message,
            resumo: { total: p.totalProcesses, sucesso: p.processedCount, falhas: p.totalProcesses - p.processedCount },
            tipoServico: 'advogados',
            advogadosJobId: p.status === 'completed' ? jobId : undefined,
          });
        }
      } catch {  }
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

    if (filtrosAdv.length > 0) params.filtros = filtrosAdv;

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
    } catch {  }
  }, [jobAdvogados, stopPolling]);

  const handleSubmit = useCallback(() => {
    if (servicoAtivo === 'processos') handleDownloadProcessos();
    else if (servicoAtivo === 'advogados') handleGerarPlanilha();
  }, [servicoAtivo, handleDownloadProcessos, handleGerarPlanilha]);

  const mostrandoDownload = etapa === 'download' && sessao.perfilSelecionado;
  const mostrandoResultado = resultado !== null;

  const modosSuportados: PJEDownloadMode[] = servicoAtivo === 'advogados'
    ? ['by_task', 'by_tag']
    : ['by_task', 'by_tag', 'by_number'];

  // Pesquisa Geral abre uma TELA INTEIRA dedicada (mantém toda a sessão em memória).
  if (mostrandoDownload && servicoAtivo === 'pesquisa' && sessao.perfilSelecionado && sessao.sessionId) {
    return (
      <TelaPesquisaGeral
        sessionId={sessao.sessionId}
        perfil={sessao.perfilSelecionado}
        usuario={sessao.usuario}
        onVoltar={() => setServicoAtivo(null)}
        onMudarPerfil={handleMudarPerfil}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* ===== Barra superior institucional (azul) ===== */}
      <header className="sticky top-0 z-30 bg-gradient-to-r from-navy-900 via-navy-800 to-navy-700 text-white shadow-lg shadow-navy-900/20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-brass-300 ring-1 ring-white/15 backdrop-blur">
              <Landmark size={20} />
            </span>
            <div className="leading-tight">
              <h1 className="font-display text-xl font-semibold tracking-tight text-white">
                Fórum <span className="text-brass-300">Hub</span>
              </h1>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-navy-200">PJE · TJBA</p>
            </div>
          </div>

          {sessao.autenticado && (
            <div className="flex items-center gap-2">
              {sessao.usuario && (
                <span className="mr-1 hidden text-xs text-navy-200 sm:inline">
                  {sessao.usuario.nomeUsuario}
                </span>
              )}
              {sessao.perfilSelecionado && !isAnyTaskActive && (
                <button
                  type="button" onClick={handleMudarPerfil}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 transition-colors hover:bg-white/15"
                >
                  <UserCog size={14} /> <span className="hidden sm:inline">Perfil</span>
                </button>
              )}
              <button
                type="button" onClick={handleLogout} disabled={isAnyTaskActive}
                title={isAnyTaskActive ? 'Aguarde a conclusão da tarefa' : 'Sair do PJE'}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 transition-colors hover:border-red-300/40 hover:bg-red-500/15 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <LogOut size={14} /> <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          )}
        </div>
        {/* filete em latão para realçar a identidade */}
        <div className="h-[3px] w-full bg-gradient-to-r from-brass-400/0 via-brass-400/70 to-brass-400/0" />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="mb-8 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight text-ink">Central de processos</h2>
          <p className="mt-1.5 text-sm text-slate-500">Baixe processos e gere planilhas do PJE/TJBA com poucos cliques.</p>
        </div>

        {/* ===== Fluxo de autenticação ===== */}
        {!mostrandoDownload && (
          <div key={etapa} className="animate-fade">
            {(etapa === 'login' || etapa === '2fa') && (
              <EtapaLogin
                carregando={carregando}
                erro={erro}
                aguardando2FA={etapa === '2fa'}
                twoFactorType={sessao.twoFactorType}
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

        {/* ===== Operação ===== */}
        {mostrandoDownload && (
          <div className="surface p-6 sm:p-7 animate-rise">
            {sessao.perfilSelecionado && !mostrandoResultado && (
              <div className="mb-6 border-b border-slate-100 pb-4">
                <ProfileBadge perfil={sessao.perfilSelecionado} />
              </div>
            )}

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
                acaoExtra={resultado.advogadosJobId ? <BotaoDownloadPlanilha jobId={resultado.advogadosJobId} /> : undefined}
              />
            )}

            {!mostrandoResultado && (
              <>
                {erro && (
                  <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
                    <span>{erro}</span>
                  </div>
                )}

                {execucao.downloadStatus !== 'idle' && servicoAtivo === 'processos' && (
                  <div className="mb-6">
                    <ExecutionStatus estado={execucao} onCancelar={execucao.isDownloading ? handleCancelarDownload : undefined} />
                    {downloadProgress && downloadProgress.files.length > 0 && (
                      <div className="scroll-area mt-2 max-h-28 overflow-y-auto rounded-xl border border-slate-100 p-2">
                        {downloadProgress.files.slice(-6).reverse().map((f, i) => (
                          <div key={`${f.name}-${i}`} className="flex items-center gap-2 py-0.5 text-xs">
                            {f.status === 'ok' && <CheckCircle size={11} className="text-emerald-500" />}
                            {f.status === 'downloading' && <Loader2 size={11} className="animate-spin text-navy-500" />}
                            {f.status === 'error' && <X size={11} className="text-red-500" />}
                            {f.status === 'not_available' && <AlertCircle size={11} className="text-brass-500" />}
                            <span className={`truncate ${f.status === 'error' ? 'text-red-600' : f.status === 'not_available' ? 'text-brass-600' : 'text-slate-600'}`}>{f.name}</span>
                            {f.size > 0 && <span className="flex-shrink-0 text-slate-400">{formatBytes(f.size)}</span>}
                            {f.status === 'not_available' && <span className="flex-shrink-0 text-[10px] text-brass-500">não disp.</span>}
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
                  <div className="space-y-8">
                    <ServiceSelector
                      servicoSelecionado={servicoAtivo}
                      onSelecionar={(s) => {
                        setServicoAtivo(s);
                        setErro(null);
                        setTarefaSelecionada('');
                        setEtiquetaSelecionada(null);
                        setNumerosProcessoRaw('');
                        setTiposSelecionados([]);
                        if (s === 'advogados' && modo === 'by_number') setModo('by_task');
                        setFiltrosAdv([]);
                      }}
                    />

                    {servicoAtivo && (
                      <DownloadModeSelector
                        modoSelecionado={modo}
                        onSelecionar={(m) => {
                          if (servicoAtivo === 'advogados' && m === 'by_number') return;
                          setModo(m);
                          setTarefaSelecionada('');
                          setEtiquetaSelecionada(null);
                          setNumerosProcessoRaw('');
                        }}
                        desabilitado={!servicoAtivo}
                        modosSuportados={modosSuportados}
                      />
                    )}

                    {servicoAtivo && (
                      <div>
                        <div className="mb-3 flex items-center gap-2">
                          <span className="num-badge">3</span>
                          <span className="eyebrow">
                            {modo === 'by_task' ? 'Selecione a tarefa' : modo === 'by_tag' ? 'Selecione a etiqueta' : 'Cole a lista de processos'}
                          </span>
                        </div>

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
                              <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3">
                                <span className="truncate text-sm font-semibold text-ink">{tarefaSelecionada}</span>
                                <span className="chip flex-shrink-0 bg-navy-100 text-navy-700">{totalProcessosTarefa} processo(s)</span>
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

                        {modo === 'by_number' && (
                          <ListaProcessos valor={numerosProcessoRaw} onChange={setNumerosProcessoRaw} />
                        )}
                      </div>
                    )}

                    {servicoAtivo === 'processos' && (
                      <div>
                        <div className="mb-3 flex items-center gap-2">
                          <span className="num-badge">4</span>
                          <span className="eyebrow">Tipos de documento</span>
                        </div>
                        <SeletorTipoDocumento selecionados={tiposSelecionados} onChange={setTiposSelecionados} />
                      </div>
                    )}

                    {servicoAtivo === 'advogados' && (
                      <FiltrosAdvogados filtros={filtrosAdv} onChange={setFiltrosAdv} />
                    )}

                    {servicoAtivo === 'processos' && (
                      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-500">
                        {fsApiSupported
                          ? <><HardDrive size={13} /> Os PDFs serão salvos direto no seu computador.</>
                          : <><FileArchive size={13} /> Os PDFs serão empacotados em um ZIP para download.</>}
                      </div>
                    )}

                    <DownloadAction
                      servico={servicoAtivo}
                      modo={modo}
                      tarefaSelecionada={tarefaSelecionada}
                      etiquetaSelecionada={etiquetaSelecionada}
                      numerosProcesso={numerosValidados}
                      tiposSelecionados={tiposSelecionados}
                      carregando={carregando}
                      fsApiSupported={fsApiSupported}
                      totalProcessos={totalProcessosTarefa}
                      onClick={handleSubmit}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200/70 py-6">
        <p className="text-center text-xs text-slate-400">
          Sistema interno de apoio ao PJE/TJBA · {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}

function BotaoDownloadPlanilha({ jobId }: { jobId: string }) {
  const [baixando, setBaixando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);

  const handleDownload = async () => {
    setBaixando(true);
    setErroDownload(null);
    try { await downloadPlanilha(jobId); }
    catch (err: any) { setErroDownload(err.message || 'Erro ao baixar planilha'); }
    finally { setBaixando(false); }
  };

  return (
    <>
      <button type="button" onClick={handleDownload} disabled={baixando} className="btn btn-emerald w-full py-2.5 text-sm">
        {baixando ? <><Loader2 size={16} className="animate-spin" /> Baixando…</> : <><CheckCircle size={16} /> Baixar planilha</>}
      </button>
      {erroDownload && <p className="mt-2 text-center text-xs text-red-600">{erroDownload}</p>}
    </>
  );
}
