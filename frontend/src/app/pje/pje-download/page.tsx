/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeft, LogOut, Lock, User, ClipboardList,
  AlertCircle, HardDrive, FileArchive,
  Loader2, CheckCircle, X,
  Search,
} from 'lucide-react';

// Componentes do módulo PJE
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

// API centralizada
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
} from '../../componentes/pje-download/types';
import { logger, ESTADO_EXECUCAO_INICIAL } from '../../componentes/pje-download/types';

// Lib de download (mantida do projeto original)
import { FileSystemManager } from '../../lib/filesystem-manager';
import { DownloadManager, type DownloadProgress, type DownloadManagerParams } from '../../lib/download-manager';

// ── Indicador de etapas do wizard ────────────────────────

const ETAPAS_WIZARD: { id: EtapaWizard; rotulo: string; icone: React.ReactNode }[] = [
  { id: 'login', rotulo: 'Login', icone: <Lock size={14} /> },
  { id: 'perfil', rotulo: 'Perfil', icone: <User size={14} /> },
  { id: 'download', rotulo: 'Download', icone: <ClipboardList size={14} /> },
];

function IndicadorEtapas({ etapaAtual }: { etapaAtual: EtapaWizard }) {
  const etapaIdx = ETAPAS_WIZARD.findIndex((e) =>
    e.id === etapaAtual || (etapaAtual === '2fa' && e.id === 'login')
  );
  return (
    <div className="flex items-center gap-1">
      {ETAPAS_WIZARD.map((etapa, idx) => {
        const concluida = idx < etapaIdx;
        const ativa = idx === etapaIdx;
        return (
          <React.Fragment key={etapa.id}>
            {idx > 0 && <div className={`w-6 h-0.5 ${concluida ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
            <div className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold transition-colors ${ativa ? 'bg-slate-900 text-white' : concluida ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
              }`}>
              {etapa.icone}
              <span className="hidden md:inline">{etapa.rotulo}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────

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
  const [logs, setLogs] = useState<EntradaLog[]>([]);
  const addLog = useCallback((nivel: EntradaLog['nivel'], modulo: string, mensagem: string, dados?: unknown) => {
    const entry: EntradaLog = {
      id: ++logIdCounter,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      nivel, modulo, mensagem, dados,
    };
    setLogs((prev) => [entry, ...prev].slice(0, 200));
    logger[nivel](modulo, mensagem, dados);
  }, []);
  const limpar = useCallback(() => setLogs([]), []);
  return { logs, addLog, limpar };
}

// ── Componente principal da página ───────────────────────

export default function PaginaDownloadPJE() {
  // Estado do wizard de autenticação
  const [etapa, setEtapa] = useState<EtapaWizard>('login');
  const [sessao, setSessao] = useState<SessaoPJE>({ autenticado: false });
  const [credenciais, setCredenciais] = useState<{ cpf: string; password: string } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Estado da interface de download
  const [servicoAtivo, setServicoAtivo] = useState<ServicoAtivo | null>(null);
  const [modo, setModo] = useState<PJEDownloadMode>('by_task');
  const [tarefaSelecionada, setTarefaSelecionada] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [etiquetaSelecionada, setEtiquetaSelecionada] = useState<number | null>(null);
  const [numerosProcesso, setNumerosProcesso] = useState('');

  // Estado de execução — variáveis amigáveis para acompanhamento
  const [execucao, setExecucao] = useState<EstadoExecucao>(ESTADO_EXECUCAO_INICIAL);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const managerRef = useRef<DownloadManager | null>(null);

  // Estado do job de advogados
  const [jobAdvogados, setJobAdvogados] = useState<{
    jobId: string; status: string; progress: number;
    message: string; totalProcesses: number; processedCount: number;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Filtro de advogados
  const [tipoFiltroAdv, setTipoFiltroAdv] = useState<'nome' | 'oab'>('nome');
  const [valorFiltroAdv, setValorFiltroAdv] = useState('');

  const { logs, addLog, limpar: limparLogs } = useUiLogs();

  const fsApiSupported = typeof window !== 'undefined' && FileSystemManager?.isSupported?.();
  const numerosParseados = numerosProcesso.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);

  const totalProcessosTarefa = useMemo(() => {
    const lista = isFavorite ? (sessao.tarefasFavoritas || []) : (sessao.tarefas || []);
    return lista.find((t) => t.nome === tarefaSelecionada)?.quantidadePendente || 0;
  }, [sessao.tarefas, sessao.tarefasFavoritas, tarefaSelecionada, isFavorite]);

  const isDownloadActive = downloadProgress && !['done', 'error', 'cancelled'].includes(downloadProgress.phase);
  const isAdvogadosActive = jobAdvogados && !['completed', 'failed', 'cancelled'].includes(jobAdvogados.status);

  // ── Ações de autenticação ──────────────────────────────

  const handleLogout = useCallback(() => {
    addLog('info', 'AUTH', 'Logout');
    setSessao({ autenticado: false });
    setCredenciais(null);
    setEtapa('login');
    setErro(null);
    setServicoAtivo(null);
  }, [addLog]);

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

  const handleVoltarPerfil = useCallback(() => {
    setEtapa('perfil');
    setErro(null);
    setServicoAtivo(null);
  }, []);

  // ── Ações de download de processos (stream) ────────────

  const handleDownloadProcessos = useCallback(async () => {
    setErro(null);
    setDownloadProgress(null);
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
    } else {
      params.processNumbers = numerosParseados;
    }

    try {
      await manager.execute(params, (p) => {
        setDownloadProgress({ ...p });
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
  }, [modo, tarefaSelecionada, isFavorite, etiquetaSelecionada, sessao, numerosParseados]);

  const handleCancelarDownload = useCallback(() => {
    managerRef.current?.cancel();
  }, []);

  // ── Ações de planilha de advogados ─────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
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
        }
      } catch { /* silent */ }
    }, 3000);
  }, [stopPolling]);

  const handleGerarPlanilha = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setJobAdvogados(null);

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

    if (valorFiltroAdv.trim()) {
      params.filtro = { tipo: tipoFiltroAdv, valor: valorFiltroAdv.trim() };
    }

    try {
      const result = await gerarPlanilhaAdvogados(params);
      setJobAdvogados({ jobId: result.jobId, status: 'listing', progress: 0, message: 'Iniciando...', totalProcesses: 0, processedCount: 0 });
      startPolling(result.jobId);
    } catch (err: any) {
      setErro(err.message || 'Erro ao iniciar geração');
      setCarregando(false);
    }
  }, [credenciais, modo, tarefaSelecionada, isFavorite, etiquetaSelecionada, sessao, tipoFiltroAdv, valorFiltroAdv, startPolling]);

  const handleCancelarAdvogados = useCallback(async () => {
    if (!jobAdvogados) return;
    try {
      await cancelarPlanilhaAdvogados(jobAdvogados.jobId);
      stopPolling();
      setJobAdvogados((p) => p ? { ...p, status: 'cancelled', message: 'Cancelado.' } : null);
      setCarregando(false);
    } catch { /* silent */ }
  }, [jobAdvogados, stopPolling]);

  // ── Handler de submit unificado ────────────────────────

  const handleSubmit = useCallback(() => {
    if (servicoAtivo === 'processos') {
      handleDownloadProcessos();
    } else if (servicoAtivo === 'advogados') {
      handleGerarPlanilha();
    }
  }, [servicoAtivo, handleDownloadProcessos, handleGerarPlanilha]);

  // ── Derivações ─────────────────────────────────────────

  const etapaAtual: EtapaWizard = etapa === '2fa' ? 'login' : etapa;
  const mostrandoDownload = etapa === 'download' && sessao.perfilSelecionado;

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      
      <main className="flex-1 max-w-4xl mx-auto px-6 py-8 w-full">
        {/* Título da página */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-slate-900 mb-1">Download PJE</h2>
          <p className="text-sm text-slate-500">PJE/TJBA — Baixe processos e gere planilhas</p>

          {/* Perfil ativo - minimalista */}
          {sessao.perfilSelecionado && (
            <div className="mt-3">
              <ProfileBadge perfil={sessao.perfilSelecionado} />
            </div>
          )}
        </div>

        {/* Etapas de autenticação */}
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

        {/* Interface principal de download */}
        {mostrandoDownload && (
          <div className="max-w-3xl bg-white border-2 border-slate-200 p-6">
            {/* Erro global */}
            {erro && (
              <div className="mb-6 p-3 bg-red-50 border-2 border-red-200 flex items-start gap-2">
                <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{erro}</p>
              </div>
            )}

            {/* Status de execução - processos */}
            {execucao.downloadStatus !== 'idle' && servicoAtivo === 'processos' && (
              <div className="mb-6">
                <ExecutionStatus
                  estado={execucao}
                  onCancelar={execucao.isDownloading ? handleCancelarDownload : undefined}
                />
                {/* Lista de arquivos recentes */}
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

            {/* Status de execução - advogados */}
            {jobAdvogados && servicoAtivo === 'advogados' && (
              <div className="mb-6">
                <ProgressoJob
                  status={jobAdvogados.status}
                  progress={jobAdvogados.progress}
                  message={jobAdvogados.message}
                  processedCount={jobAdvogados.processedCount}
                  totalProcesses={jobAdvogados.totalProcesses}
                  onDownload={jobAdvogados.status === 'completed' ? () => downloadPlanilha(jobAdvogados.jobId) : undefined}
                  onCancelar={isAdvogadosActive ? handleCancelarAdvogados : undefined}
                />
              </div>
            )}

            {/* Não mostrar formulário durante execução ativa */}
            {!isDownloadActive && !isAdvogadosActive && (
              <>
                {/* SEÇÃO 1: Seleção de serviço */}
                <div className="mb-8">
                  <ServiceSelector
                    servicoSelecionado={servicoAtivo}
                    onSelecionar={(s) => {
                      setServicoAtivo(s);
                      setErro(null);
                      setTarefaSelecionada('');
                      setEtiquetaSelecionada(null);
                      setNumerosProcesso('');
                    }}
                  />
                </div>

                {/* SEÇÃO 2: Modo de download */}
                {servicoAtivo && (
                  <div className="mb-8">
                    <DownloadModeSelector
                      modoSelecionado={modo}
                      onSelecionar={(m) => {
                        setModo(m);
                        setTarefaSelecionada('');
                        setEtiquetaSelecionada(null);
                        setNumerosProcesso('');
                      }}
                      desabilitado={!servicoAtivo}
                    />
                  </div>
                )}

                {/* SEÇÃO 3: Seleção de tarefa/etiqueta/número */}
                {servicoAtivo && (
                  <div className="mb-4">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3 block">
                      3. {modo === 'by_task' ? 'Selecione a tarefa' : modo === 'by_tag' ? 'Selecione a etiqueta' : 'Informe os números'}
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

                    {modo === 'by_number' && (
                      <div>
                        <textarea
                          value={numerosProcesso}
                          onChange={(e) => setNumerosProcesso(e.target.value)}
                          placeholder={'Cole os números aqui, um por linha.\nFormato: NNNNNNN-DD.AAAA.J.TT.OOOO'}
                          rows={6}
                          className="w-full p-3 border-2 border-slate-200 text-sm font-mono focus:border-slate-400 focus:outline-none resize-none"
                        />
                        <div className="flex justify-between mt-2">
                          <p className="text-xs text-slate-400">Separe por linha, vírgula ou ponto e vírgula.</p>
                          <p className="text-xs text-slate-500 font-bold">{numerosParseados.length} processo(s)</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Filtro de advogados (apenas para serviço advogados) */}
                {servicoAtivo === 'advogados' && modo !== 'by_number' && (
                  <div className="mb-4 p-4 bg-amber-50 border border-amber-200">
                    <div className="flex items-center gap-2 mb-3">
                      <Search size={14} className="text-amber-700" />
                      <span className="text-xs font-bold text-amber-800 uppercase tracking-wide">Filtrar por Advogado (opcional)</span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      {(['nome', 'oab'] as const).map((t) => (
                        <button key={t} type="button" onClick={() => setTipoFiltroAdv(t)}
                          className={`px-3 py-1.5 text-xs font-bold transition-colors ${tipoFiltroAdv === t ? 'bg-amber-700 text-white' : 'bg-white border border-amber-300 text-amber-700'}`}>
                          {t === 'nome' ? 'Nome' : 'OAB'}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={valorFiltroAdv}
                      onChange={(e) => setValorFiltroAdv(e.target.value)}
                      placeholder={tipoFiltroAdv === 'nome' ? 'Ex: Felipe, Paulo...' : 'Ex: BA33407, SE6662...'}
                      className="w-full px-3 py-2 border border-amber-200 text-sm focus:border-amber-400 focus:outline-none bg-white"
                    />
                    <p className="text-xs text-amber-600 mt-1">
                      {!valorFiltroAdv.trim() ? 'Deixe vazio para incluir todos os advogados.' : ''}
                    </p>
                  </div>
                )}

                {/* Info sobre modo de salvamento (compacto) */}
                {servicoAtivo === 'processos' && (
                  <div className="mb-2 px-3 py-2 bg-slate-50 border border-slate-200 flex items-center gap-2 text-xs text-slate-500">
                    {fsApiSupported
                      ? <><HardDrive size={12} /> PDFs serão salvos direto no seu computador</>
                      : <><FileArchive size={12} /> PDFs serão empacotados em ZIP para download</>}
                  </div>
                )}
              </>
            )}

            {/* SEÇÃO 4: Botão de ação principal */}
            {!isDownloadActive && !isAdvogadosActive && (
              <DownloadAction
                servico={servicoAtivo}
                modo={modo}
                tarefaSelecionada={tarefaSelecionada}
                etiquetaSelecionada={etiquetaSelecionada}
                numerosProcesso={numerosParseados}
                carregando={carregando}
                fsApiSupported={fsApiSupported}
                totalProcessos={totalProcessosTarefa}
                onClick={handleSubmit}
              />
            )}
          </div>
        )}
      </main>

    </div>
  );
}