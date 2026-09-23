'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, FileArchive, Hash, Info, Loader2, Tags, Tag, AlertTriangle, RotateCcw, SlidersHorizontal,
  Plus, Trash2, User, ShieldAlert, ChevronDown, ChevronUp, X, Save, BookmarkCheck, Hourglass,
} from 'lucide-react';
import { BarraStatusFixa } from './BarraStatusFixa';
import { CampoBusca } from './CampoBusca';
import { ListaTarefas, type TarefaSelecionada } from './ListaTarefas';
import { ProgressoJob } from './ProgressoJob';
import { notificar } from './Toast';
import {
  normalizarStatus, notificarNavegador, pedirPermissaoNotificacao, rolarAte, useRolarNoProgresso, useTituloAba,
} from './feedback';
import type { EtiquetaPJE, TarefaPJE } from './types';
import { safeStr } from './types';
import {
  gerarPlanilhaDigito, obterProgressoDigito, cancelarPlanilhaDigito, downloadPlanilhaDigito,
  etiquetarPorDigito, obterProgressoEtiquetagem, cancelarEtiquetagemDigito,
  obterConfigDigito, salvarConfigDigito, limparConfigDigito, obterPadroesFilaEspera,
  type ConfigAutomacaoDigito, type ConfigAutomacaoDigitoInput,
  type EtiquetagemDigitoProgress, type ModoDigito, type PlanilhaDigitoProgress, type PlanilhaDigitoResumo,
} from './api-planilha-digito';

const DIGITOS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const POLL_INTERVAL_MS = 2500;
const TERMINAIS = ['completed', 'failed', 'cancelled'];
const ROTULO = 'Automações por dígito';

interface ServidorDigitos { nome: string; digitos: number[]; etiqueta?: EtiquetaPJE; }

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Exemplo 8001732-90.2023…: sequencial → 2, verificador1 → 9, verificador2 → 0.
const MODOS_DIGITO: Array<{ valor: ModoDigito; rotulo: string; exemplo: React.ReactNode }> = [
  { valor: 'sequencial', rotulo: 'Último do sequencial', exemplo: <>800173<strong>2</strong>-90.2023</> },
  { valor: 'verificador1', rotulo: '1º dígito verificador', exemplo: <>8001732-<strong>9</strong>0.2023</> },
  { valor: 'verificador2', rotulo: '2º dígito verificador', exemplo: <>8001732-9<strong>0</strong>.2023</> },
];

interface TelaPlanilhaDigitoProps {
  sessionId: string;
  tarefas: TarefaPJE[];
  etiquetas: EtiquetaPJE[];
  credenciais: { cpf: string; password: string } | null;
  perfilIndice?: number;
}

export function TelaPlanilhaDigito({ sessionId, tarefas, etiquetas, credenciais, perfilIndice }: TelaPlanilhaDigitoProps) {
  const [modoDigito, setModoDigito] = useState<ModoDigito>('sequencial');
  const [servidores, setServidores] = useState<ServidorDigitos[]>([{ nome: '', digitos: [] }]);
  const [ignoradas, setIgnoradas] = useState<TarefaSelecionada[]>([]);
  const [formato, setFormato] = useState<'xlsx' | 'zip'>('xlsx');
  const [reduzida, setReduzida] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [job, setJob] = useState<PlanilhaDigitoProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressoRef = useRef<HTMLDivElement | null>(null);
  const statusAnterior = useRef<string | null>(null);

  // null = usa os termos padrão do motor.
  const [padroesFila, setPadroesFila] = useState<string[] | null>(null);
  const [padroesFilaPadrao, setPadroesFilaPadrao] = useState<string[]>([]);

  const [configSalva, setConfigSalva] = useState<ConfigAutomacaoDigito | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [avisoConfig, setAvisoConfig] = useState<string | null>(null);
  const formularioTocado = useRef(false);

  const [etiquetagem, setEtiquetagem] = useState<EtiquetagemDigitoProgress | null>(null);
  const [confirmandoEtq, setConfirmandoEtq] = useState(false);
  const [iniciandoEtq, setIniciandoEtq] = useState(false);
  const pollEtqRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const etiquetagemRef = useRef<HTMLDivElement | null>(null);
  const statusEtqAnterior = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  const stopPollingEtq = useCallback(() => {
    if (pollEtqRef.current) { clearInterval(pollEtqRef.current); pollEtqRef.current = null; }
  }, []);

  useEffect(() => () => { stopPolling(); stopPollingEtq(); }, [stopPolling, stopPollingEtq]);

  const statusUi = normalizarStatus(job?.status);
  const statusEtqUi = normalizarStatus(etiquetagem?.status);
  const jobAtivo = statusUi === 'running';
  const etiquetagemAtiva = statusEtqUi === 'running';
  useTituloAba(etiquetagemAtiva ? statusEtqUi : statusUi, etiquetagemAtiva ? etiquetagem?.progress : job?.progress, ROTULO);
  useRolarNoProgresso(progressoRef, statusUi);
  useRolarNoProgresso(etiquetagemRef, statusEtqUi);

  useEffect(() => {
    const atual = job?.status ?? null;
    const antes = statusAnterior.current;
    statusAnterior.current = atual;
    if (!job || !atual || !TERMINAIS.includes(atual) || antes === null || TERMINAIS.includes(antes)) return;
    if (atual === 'completed') {
      const titulo = `Planilha pronta: ${job.totalProcesses} processo(s)`;
      notificar({ tom: 'sucesso', titulo, acao: { rotulo: 'Ver resultado', onClick: () => rolarAte(progressoRef.current) } });
      notificarNavegador(`Fórum Hub — ${ROTULO}`, titulo);
    } else if (atual === 'failed') {
      notificar({ tom: 'erro', titulo: 'A geração da planilha falhou', descricao: job.message, acao: { rotulo: 'Ver detalhes', onClick: () => rolarAte(progressoRef.current) } });
      notificarNavegador(`Fórum Hub — ${ROTULO}`, 'A geração falhou.');
    } else {
      notificar({ tom: 'info', titulo: 'Geração cancelada' });
    }
  }, [job]);

  useEffect(() => {
    const atual = etiquetagem?.status ?? null;
    const antes = statusEtqAnterior.current;
    statusEtqAnterior.current = atual;
    if (!etiquetagem || !atual || !TERMINAIS.includes(atual) || antes === null || TERMINAIS.includes(antes)) return;
    if (atual === 'completed') {
      const titulo = `Etiquetagem concluída: ${etiquetagem.inseridas} inserida(s), ${etiquetagem.removidas} removida(s)${etiquetagem.erros ? `, ${etiquetagem.erros} erro(s)` : ''}`;
      notificar({ tom: etiquetagem.erros > 0 ? 'info' : 'sucesso', titulo, acao: { rotulo: 'Ver resultado', onClick: () => rolarAte(etiquetagemRef.current) } });
      notificarNavegador(`Fórum Hub — ${ROTULO}`, titulo);
    } else if (atual === 'failed') {
      notificar({ tom: 'erro', titulo: 'A etiquetagem falhou', descricao: etiquetagem.message, acao: { rotulo: 'Ver detalhes', onClick: () => rolarAte(etiquetagemRef.current) } });
      notificarNavegador(`Fórum Hub — ${ROTULO}`, 'A etiquetagem falhou.');
    } else {
      notificar({ tom: 'info', titulo: 'Etiquetagem cancelada' });
    }
  }, [etiquetagem]);

  const atribuicoesValidas = useMemo(
    () => servidores
      .filter((s) => s.nome.trim())
      .flatMap((s) => s.digitos.map((digito) => ({
        digito,
        servidor: s.nome.trim(),
        ...(s.etiqueta ? { etiqueta: { id: s.etiqueta.id, nome: s.etiqueta.nomeTag } } : {}),
      }))),
    [servidores],
  );

  const resumoServidores = useMemo(() => {
    const grupos = new Map<string, { nome: string; digitos: number[]; etiquetas: string[]; semEtiqueta: boolean }>();
    for (const s of servidores) {
      const nome = s.nome.trim();
      if (!nome || s.digitos.length === 0) continue;
      const chave = normalizar(nome);
      const grupo = grupos.get(chave) ?? { nome, digitos: [], etiquetas: [], semEtiqueta: false };
      grupo.digitos.push(...s.digitos);
      const etq = s.etiqueta ? safeStr(s.etiqueta.nomeTagCompleto) || safeStr(s.etiqueta.nomeTag) : '';
      if (etq && !grupo.etiquetas.includes(etq)) grupo.etiquetas.push(etq);
      if (!s.etiqueta) grupo.semEtiqueta = true;
      grupos.set(chave, grupo);
    }
    return [...grupos.values()].map((g) => ({ ...g, digitos: g.digitos.sort((a, b) => a - b) }));
  }, [servidores]);

  const temEtiquetaVinculada = atribuicoesValidas.some((a) => a.etiqueta);

  const digitosSemServidor = DIGITOS.filter((d) => !atribuicoesValidas.some((a) => a.digito === d));

  const configAtual = useMemo<ConfigAutomacaoDigitoInput>(() => ({
    servidores: servidores
      .filter((s) => s.nome.trim() || s.digitos.length > 0)
      .map((s) => ({
        nome: s.nome.trim(),
        digitos: s.digitos,
        ...(s.etiqueta ? { etiqueta: { id: s.etiqueta.id, nome: s.etiqueta.nomeTag } } : {}),
      })),
    modoDigito,
    tarefasIgnoradas: ignoradas.map((t) => t.nome),
    formato,
    reduzida,
    ...(padroesFila ? { padroesFilaEspera: padroesFila } : {}),
  }), [servidores, modoDigito, ignoradas, formato, reduzida, padroesFila]);

  const assinaturaSalva = useMemo(() => configSalva ? JSON.stringify({
    servidores: configSalva.servidores, modoDigito: configSalva.modoDigito,
    tarefasIgnoradas: configSalva.tarefasIgnoradas, formato: configSalva.formato, reduzida: configSalva.reduzida,
    ...(configSalva.padroesFilaEspera ? { padroesFilaEspera: configSalva.padroesFilaEspera } : {}),
  }) : null, [configSalva]);
  const alteracoesNaoSalvas = assinaturaSalva !== null && assinaturaSalva !== JSON.stringify(configAtual);

  // Etiquetas salvas viram objetos da sessão atual; as que sumiram do perfil ficam de fora com aviso.
  const aplicarConfig = useCallback((cfg: ConfigAutomacaoDigito) => {
    const perdidas: string[] = [];
    const lista: ServidorDigitos[] = (Array.isArray(cfg?.servidores) ? cfg.servidores : []).map((s) => {
      let etiqueta: EtiquetaPJE | undefined;
      if (s.etiqueta) {
        etiqueta = etiquetas.find((e) => e?.id === s.etiqueta!.id);
        if (!etiqueta) perdidas.push(`${s.etiqueta.nome} (${s.nome || 'sem nome'})`);
      }
      return { nome: s.nome ?? '', digitos: Array.isArray(s.digitos) ? [...s.digitos] : [], etiqueta };
    });
    setServidores(lista.length > 0 ? lista : [{ nome: '', digitos: [] }]);
    setModoDigito(cfg.modoDigito ?? 'sequencial');
    setIgnoradas((cfg.tarefasIgnoradas ?? []).map((nome) => ({ nome, favorita: false })));
    setFormato(cfg.formato === 'zip' ? 'zip' : 'xlsx');
    setReduzida(cfg.reduzida === true);
    setPadroesFila(cfg.padroesFilaEspera ?? null);
    setAvisoConfig(perdidas.length > 0 ? `Etiqueta(s) não encontrada(s) neste perfil e desvinculada(s): ${perdidas.join(', ')}.` : null);
  }, [etiquetas]);

  useEffect(() => {
    obterPadroesFilaEspera().then((r) => setPadroesFilaPadrao(r.padrao)).catch(() => { /* fica sem os termos padrão à mostra */ });
  }, []);

  useEffect(() => {
    let ativo = true;
    obterConfigDigito(sessionId)
      .then((cfg) => {
        if (!ativo || !cfg || !Array.isArray(cfg.servidores)) return;
        setConfigSalva(cfg);
        if (!formularioTocado.current) aplicarConfig(cfg);
      })
      .catch(() => { /* sem configuração salva ou servidor fora: segue com o formulário vazio */ });
    return () => { ativo = false; };
    // Carrega uma vez por sessão; as etiquetas usadas na resolução são as da sessão nesse momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const salvarConfig = useCallback(async (silencioso: boolean) => {
    setSalvandoConfig(true);
    try {
      const salva = await salvarConfigDigito(sessionId, configAtual);
      setConfigSalva(salva);
      if (!silencioso) notificar({ tom: 'sucesso', titulo: 'Configuração salva para este perfil' });
    } catch (err) {
      if (!silencioso) notificar({ tom: 'erro', titulo: 'Não foi possível salvar a configuração', descricao: err instanceof Error ? err.message : undefined });
    } finally {
      setSalvandoConfig(false);
    }
  }, [sessionId, configAtual]);

  const handleLimparConfig = useCallback(async () => {
    try {
      await limparConfigDigito(sessionId);
      setConfigSalva(null);
      setAvisoConfig(null);
      notificar({ tom: 'info', titulo: 'Configuração salva removida' });
    } catch (err) {
      notificar({ tom: 'erro', titulo: 'Não foi possível remover a configuração', descricao: err instanceof Error ? err.message : undefined });
    }
  }, [sessionId]);

  const handleRestaurarConfig = useCallback(() => {
    if (configSalva) aplicarConfig(configSalva);
  }, [configSalva, aplicarConfig]);

  const donoDoDigito = (digito: number) => servidores.findIndex((s) => s.digitos.includes(digito));
  const donoDaEtiqueta = (id: number, idx: number) => servidores.find((s, i) => i !== idx && s.etiqueta?.id === id
    && normalizar(s.nome) !== normalizar(servidores[idx].nome));

  const setNome = useCallback((idx: number, nome: string) => {
    formularioTocado.current = true;
    setServidores((prev) => prev.map((s, i) => (i === idx ? { ...s, nome } : s)));
  }, []);

  // Uma etiqueta identifica um único servidor: escolher aqui tira dos outros.
  const setEtiqueta = useCallback((idx: number, etiqueta: EtiquetaPJE | undefined) => {
    formularioTocado.current = true;
    setServidores((prev) => prev.map((s, i) => {
      if (i === idx) return { ...s, etiqueta };
      return etiqueta && s.etiqueta?.id === etiqueta.id && normalizar(s.nome) !== normalizar(prev[idx].nome) ? { ...s, etiqueta: undefined } : s;
    }));
  }, []);

  // Um dígito só pode ter um servidor: atribuir aqui tira dos outros.
  const atribuirDigitos = useCallback((idx: number, digitos: number[], remover: boolean) => {
    formularioTocado.current = true;
    setServidores((prev) => prev.map((s, i) => {
      const semEles = s.digitos.filter((d) => !digitos.includes(d));
      if (i !== idx || remover) return { ...s, digitos: semEles };
      return { ...s, digitos: [...semEles, ...digitos].sort((a, b) => a - b) };
    }));
  }, []);

  const toggleDigito = useCallback((idx: number, digito: number) => {
    atribuirDigitos(idx, [digito], servidores[idx].digitos.includes(digito));
  }, [atribuirDigitos, servidores]);

  const atribuirParidade = useCallback((idx: number, resto: 0 | 1) => {
    const lote = DIGITOS.filter((d) => d % 2 === resto);
    atribuirDigitos(idx, lote, lote.every((d) => servidores[idx].digitos.includes(d)));
  }, [atribuirDigitos, servidores]);

  const addServidor = useCallback(() => {
    setServidores((prev) => [...prev, { nome: '', digitos: [] }]);
  }, []);

  const removeServidor = useCallback((idx: number) => {
    setServidores((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }, []);

  const toggleIgnorada = useCallback((nome: string, favorita: boolean) => {
    formularioTocado.current = true;
    setIgnoradas((prev) => {
      const existe = prev.some((t) => t.nome === nome);
      return existe ? prev.filter((t) => t.nome !== nome) : [...prev, { nome, favorita }];
    });
  }, []);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const p = await obterProgressoDigito(jobId);
        setJob({ ...p, jobId });
        if (TERMINAIS.includes(p.status)) stopPolling();
      } catch { /* falha transitória de rede: a próxima rodada tenta de novo */ }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const startPollingEtq = useCallback((jobId: string) => {
    stopPollingEtq();
    pollEtqRef.current = setInterval(async () => {
      try {
        const p = await obterProgressoEtiquetagem(jobId);
        setEtiquetagem(p);
        if (TERMINAIS.includes(p.status)) stopPollingEtq();
      } catch { /* falha transitória de rede */ }
    }, POLL_INTERVAL_MS);
  }, [stopPollingEtq]);

  const handleGerar = useCallback(async () => {
    setErro(null);
    setIniciando(true);
    setJob(null);
    setEtiquetagem(null);
    setConfirmandoEtq(false);
    pedirPermissaoNotificacao();
    void salvarConfig(true);
    try {
      const result = await gerarPlanilhaDigito({
        credentials: credenciais ?? undefined,
        pjeSessionId: sessionId,
        pjeProfileIndex: perfilIndice,
        atribuicoes: atribuicoesValidas,
        tarefasIgnoradas: ignoradas.map((t) => t.nome),
        formato,
        reduzida,
        modoDigito,
        pesos: padroesFila ? { padroesFilaEspera: padroesFila } : undefined,
      });
      setJob({
        jobId: result.jobId, status: 'listing', progress: 0,
        totalProcesses: 0, processedCount: 0,
        message: 'Iniciando...', timestamp: Date.now(),
      });
      startPolling(result.jobId);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao iniciar geração');
    } finally {
      setIniciando(false);
    }
  }, [credenciais, sessionId, perfilIndice, atribuicoesValidas, ignoradas, formato, reduzida, modoDigito, padroesFila, startPolling, salvarConfig]);

  const handleCancelar = useCallback(async () => {
    if (!job) return;
    setJob((p) => p ? { ...p, status: 'cancelling', message: 'Cancelando...' } : null);
    try { await cancelarPlanilhaDigito(job.jobId); } catch { /* progresso reflete o estado real */ }
  }, [job]);

  const handleEtiquetar = useCallback(async () => {
    if (!job) return;
    setErro(null);
    setConfirmandoEtq(false);
    setIniciandoEtq(true);
    statusEtqAnterior.current = null;
    pedirPermissaoNotificacao();
    try {
      await etiquetarPorDigito(job.jobId, {
        pjeSessionId: sessionId,
        credentials: credenciais ?? undefined,
        pjeProfileIndex: perfilIndice,
      });
      setEtiquetagem({
        jobId: job.jobId, status: 'running', progress: 0, total: 0, feitos: 0,
        inseridas: 0, removidas: 0, erros: 0, message: 'Iniciando...', timestamp: Date.now(), processos: [],
      });
      startPollingEtq(job.jobId);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao iniciar a etiquetagem');
    } finally {
      setIniciandoEtq(false);
    }
  }, [job, sessionId, credenciais, perfilIndice, startPollingEtq]);

  const handleCancelarEtq = useCallback(async () => {
    if (!etiquetagem) return;
    setEtiquetagem((e) => e ? { ...e, status: 'cancelling', message: 'Cancelando...' } : e);
    try { await cancelarEtiquetagemDigito(etiquetagem.jobId); } catch { /* progresso reflete o estado real */ }
  }, [etiquetagem]);

  const voltarAoFormulario = useCallback(() => {
    stopPolling();
    stopPollingEtq();
    setJob(null);
    setEtiquetagem(null);
    setConfirmandoEtq(false);
    statusAnterior.current = null;
    statusEtqAnterior.current = null;
  }, [stopPolling, stopPollingEtq]);

  const planoEtq = job?.status === 'completed' ? job.resumo?.etiquetagem : undefined;
  const podeEtiquetar = !!planoEtq && planoEtq.processosAfetados > 0 && !etiquetagemAtiva;
  const servidoresSemEtiqueta = resumoServidores.filter((g) => g.semEtiqueta).map((g) => g.nome);

  const barraAtiva = jobAtivo || etiquetagemAtiva;
  const barraMensagem = etiquetagemAtiva ? (etiquetagem?.message ?? '') : (job?.message ?? '');
  const barraProgresso = etiquetagemAtiva ? (etiquetagem?.progress ?? 0) : (job?.progress ?? 0);

  return (
    <div className="space-y-8">
      {erro && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" aria-hidden />
          <span>{erro}</span>
        </div>
      )}

      {/* ───── Vista de execução/resultado ───── */}
      {job && (
        <div ref={progressoRef} className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="num-badge">{jobAtivo ? '⏳' : '✓'}</span>
              <span className="eyebrow">{ROTULO} · {resumoServidores.length} servidor(es) · {formato === 'zip' ? 'zip por servidor' : 'arquivo único'}{reduzida ? ' · reduzida' : ''}</span>
            </div>
            {!barraAtiva && (
              <div className="flex gap-2">
                <button type="button" onClick={voltarAoFormulario} className="btn btn-ghost px-3 py-1.5 text-xs">
                  <SlidersHorizontal size={13} /> Ajustar parâmetros
                </button>
                <button type="button" onClick={voltarAoFormulario} className="btn btn-ghost px-3 py-1.5 text-xs">
                  <RotateCcw size={13} /> Nova planilha
                </button>
              </div>
            )}
          </div>
          {job.status === 'completed' && job.fileName && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Formato do download">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Baixar como</span>
              {([['xlsx', 'Arquivo único', FileSpreadsheet], ['zip', 'Um por servidor (.zip)', FileArchive]] as const).map(([valor, rotulo, Icone]) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={formato === valor}
                  onClick={() => setFormato(valor)}
                  className={`btn px-3 py-1.5 text-xs ${formato === valor ? 'btn-primary' : 'btn-ghost'}`}
                >
                  <Icone size={13} /> {rotulo}
                </button>
              ))}
            </div>
          )}
          <ProgressoJob
            status={job.status}
            progress={job.progress}
            message={job.message}
            processedCount={job.processedCount}
            totalProcesses={job.totalProcesses}
            onCancelar={jobAtivo ? handleCancelar : undefined}
            onDownload={job.status === 'completed' && job.fileName ? () => downloadPlanilhaDigito(job.jobId, formato) : undefined}
          />
          {job.status === 'completed' && job.resumo && (
            <ResumoDistribuicao resumo={job.resumo} comEtiquetagem={!!planoEtq} />
          )}

          {planoEtq && (
            <div ref={etiquetagemRef} className="scroll-mt-24 space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Tags size={16} className="text-navy-700" aria-hidden />
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Etiquetar processos no PJE</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="chip bg-emerald-50 text-emerald-700">Inserir: <strong>{planoEtq.inserir}</strong></span>
                  <span className="chip bg-brass-50 text-brass-600">Remover de outro servidor: <strong>{planoEtq.remover}</strong></span>
                  <span className="chip bg-slate-100 text-slate-600">Processos afetados: <strong>{planoEtq.processosAfetados}</strong></span>
                </div>
                {planoEtq.servidoresSemEtiqueta.length > 0 && (
                  <p className="mt-2 text-xs text-slate-600">
                    Sem etiqueta vinculada, ficam de fora: {planoEtq.servidoresSemEtiqueta.join(', ')}.
                  </p>
                )}
                {planoEtq.processosAfetados === 0 ? (
                  <p className="mt-3 text-sm text-slate-700">Nada a fazer: todos os processos já estão com a etiqueta correta.</p>
                ) : !etiquetagem && !confirmandoEtq && (
                  <button type="button" onClick={() => setConfirmandoEtq(true)} disabled={!podeEtiquetar} className="btn btn-brass mt-3 w-full py-2.5 text-sm">
                    <Tags size={16} /> Etiquetar processos
                  </button>
                )}
              </div>

              {confirmandoEtq && !etiquetagemAtiva && (
                <div className="space-y-3 rounded-2xl border border-brass-200 bg-brass-50/60 p-4" role="alertdialog" aria-labelledby="confirma-etq-titulo">
                  <div className="flex items-start gap-2.5 text-sm text-slate-700">
                    <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-brass-500" aria-hidden />
                    <div className="space-y-1 text-xs leading-relaxed">
                      <p id="confirma-etq-titulo" className="text-sm font-semibold text-ink">Esta ação altera os processos no PJE.</p>
                      <p>
                        Serão inseridas <strong>{planoEtq.inserir}</strong> etiqueta(s) e removidas{' '}
                        <strong>{planoEtq.remover}</strong> etiqueta(s) de outros servidores, em{' '}
                        <strong>{planoEtq.processosAfetados}</strong> processo(s). Nenhuma outra etiqueta é tocada.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => setConfirmandoEtq(false)} className="btn btn-ghost flex-1 py-2.5 text-sm" autoFocus>
                      Voltar
                    </button>
                    <button type="button" onClick={handleEtiquetar} disabled={iniciandoEtq} className="btn btn-brass flex-1 py-2.5 text-sm">
                      {iniciandoEtq ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</> : <><Tags size={16} /> Confirmar e etiquetar</>}
                    </button>
                  </div>
                </div>
              )}

              {etiquetagem && (
                <>
                  <ProgressoJob
                    status={etiquetagem.status}
                    progress={etiquetagem.progress}
                    message={etiquetagem.message}
                    processedCount={etiquetagem.feitos}
                    totalProcesses={etiquetagem.total}
                    unidade="alterações"
                    onCancelar={etiquetagemAtiva ? handleCancelarEtq : undefined}
                    confirmarCancelamento
                  />
                  {TERMINAIS.includes(etiquetagem.status) && <ResumoEtiquetagem etiquetagem={etiquetagem} />}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ───── Formulário ───── */}
      {!job && (
        <>
          <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2 text-xs text-slate-600">
              <BookmarkCheck size={15} className={`mt-0.5 shrink-0 ${configSalva ? 'text-emerald-600' : 'text-slate-400'}`} aria-hidden />
              <span>
                {configSalva ? (
                  <>
                    Configuração deste perfil salva em <strong>{formatarDataHora(configSalva.atualizadoEm)}</strong>
                    {configSalva.atualizadoPor ? <> por {configSalva.atualizadoPor}</> : null}
                    {alteracoesNaoSalvas && <span className="ml-1.5 chip bg-brass-50 text-brass-600">alterações não salvas</span>}
                  </>
                ) : (
                  <>Nenhuma configuração salva para este perfil. Ao gerar a planilha, os servidores, dígitos e etiquetas são guardados automaticamente.</>
                )}
                {avisoConfig && <span className="mt-1 block text-brass-600">{avisoConfig}</span>}
              </span>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {configSalva && alteracoesNaoSalvas && (
                <button type="button" onClick={handleRestaurarConfig} className="btn btn-ghost px-3 py-1.5 text-xs">
                  <RotateCcw size={13} /> Restaurar
                </button>
              )}
              <button
                type="button"
                onClick={() => salvarConfig(false)}
                disabled={salvandoConfig || (configSalva !== null && !alteracoesNaoSalvas)}
                className="btn btn-ghost px-3 py-1.5 text-xs"
              >
                {salvandoConfig ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Salvar
              </button>
              {configSalva && (
                <button type="button" onClick={handleLimparConfig} className="btn btn-ghost px-3 py-1.5 text-xs" aria-label="Remover configuração salva">
                  <Trash2 size={13} /> Limpar
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">2</span>
              <span className="eyebrow">Atribua os dígitos aos servidores</span>
            </div>
            <p className="label mb-2">Qual algarismo do número CNJ é o dígito?</p>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Posição do dígito no número CNJ">
              {MODOS_DIGITO.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  role="radio"
                  aria-checked={modoDigito === m.valor}
                  onClick={() => { formularioTocado.current = true; setModoDigito(m.valor); }}
                  className={`pick px-3.5 py-3 ${modoDigito === m.valor ? 'pick-on' : ''}`}
                >
                  <span className="block text-sm font-semibold text-ink">{m.rotulo}</span>
                  <span className="mt-0.5 block font-mono text-xs text-slate-600">{m.exemplo}…</span>
                </button>
              ))}
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-navy-50 px-3.5 py-2.5 text-xs text-navy-700">
              <Info size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span>
                Informe o nome do servidor, clique nos dígitos dele e, se quiser etiquetar ao final,
                vincule a etiqueta do PJE que o identifica. Cada dígito pertence a um único servidor;
                dígitos em branco vão para a aba <strong>Não atribuídos</strong>.
              </span>
            </div>
            <div className="space-y-3">
              {servidores.map((s, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <User size={16} className="flex-shrink-0 text-navy-700" aria-hidden />
                    <input
                      type="text"
                      value={s.nome}
                      onChange={(e) => setNome(idx, e.target.value)}
                      placeholder="Nome do servidor"
                      aria-label={`Nome do servidor ${idx + 1}`}
                      className="field"
                    />
                    {servidores.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeServidor(idx)}
                        className="btn btn-ghost flex-shrink-0 px-2.5 py-2"
                        aria-label="Remover servidor"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Dígitos de ${s.nome || `servidor ${idx + 1}`}`}>
                      {DIGITOS.map((d) => {
                        const dono = donoDoDigito(d);
                        const meu = dono === idx;
                        const deOutro = dono !== -1 && !meu;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => toggleDigito(idx, d)}
                            aria-pressed={meu}
                            title={deOutro ? `Atribuído a ${servidores[dono].nome.trim() || 'outro servidor'} — clique para trazer para cá` : undefined}
                            className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-bold transition-colors ${
                              meu ? 'border-navy-800 bg-navy-800 text-white'
                                : deOutro ? 'border-dashed border-slate-300 bg-slate-50 text-slate-400'
                                  : 'border-slate-200 bg-white text-navy-700 hover:border-navy-400'
                            }`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                    <div className="ml-auto flex gap-1.5">
                      <button type="button" onClick={() => atribuirParidade(idx, 0)} className="btn btn-ghost px-3 py-2 text-xs">PARES</button>
                      <button type="button" onClick={() => atribuirParidade(idx, 1)} className="btn btn-ghost px-3 py-2 text-xs">ÍMPARES</button>
                    </div>
                  </div>
                  <div className="mt-3">
                    <SeletorEtiqueta
                      etiquetas={etiquetas}
                      selecionada={s.etiqueta}
                      onSelecionar={(e) => setEtiqueta(idx, e)}
                      donoDe={(id) => { const dono = donoDaEtiqueta(id, idx); return dono ? (dono.nome.trim() || 'outro servidor') : null; }}
                      rotulo={s.nome.trim() || `servidor ${idx + 1}`}
                    />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addServidor} className="btn btn-ghost w-full py-2.5 text-sm">
                <Plus size={15} /> Adicionar servidor
              </button>
            </div>
            {atribuicoesValidas.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {resumoServidores.map((g) => (
                  <span key={normalizar(g.nome)} className="chip bg-emerald-50 text-emerald-700">
                    {g.nome}: dígito(s) {g.digitos.join(', ')}{g.etiquetas.length > 0 ? ` · ${g.etiquetas.join(', ')}` : ''}
                  </span>
                ))}
                {digitosSemServidor.length > 0 && (
                  <span className="chip bg-slate-100 text-slate-600">
                    Sem servidor: {digitosSemServidor.join(', ')}
                  </span>
                )}
              </div>
            )}
            {temEtiquetaVinculada && servidoresSemEtiqueta.length > 0 && (
              <p className="mt-2 text-xs text-brass-600">
                Sem etiqueta vinculada (não serão etiquetados): {servidoresSemEtiqueta.join(', ')}.
              </p>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">3</span>
              <span className="eyebrow">Tarefas ignoradas (opcional)</span>
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-brass-50 px-3.5 py-2.5 text-xs text-brass-600">
              <Info size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span>
                As tarefas selecionadas aqui ficam <strong>fora</strong> da análise — o acervo
                considerado são todas as demais tarefas do painel deste perfil.
              </span>
            </div>
            <ListaTarefas
              tarefas={tarefas}
              tarefasFavoritas={[]}
              selecionadas={ignoradas}
              onToggle={toggleIgnorada}
            />
            {ignoradas.length > 0 && (
              <p className="mt-2 text-xs text-slate-600">
                {ignoradas.length} tarefa(s) ignorada(s): {ignoradas.map((t) => t.nome).join(' · ')}
              </p>
            )}
          </div>

          <FilasDeEspera
            termos={padroesFila ?? padroesFilaPadrao}
            personalizado={padroesFila !== null}
            tarefas={tarefas}
            onChange={(termos) => { formularioTocado.current = true; setPadroesFila(termos); }}
            onRestaurar={() => { formularioTocado.current = true; setPadroesFila(null); }}
          />

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">4</span>
              <span className="eyebrow">Formato de saída</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Formato de saída">
              <FormatoBtn
                ativo={formato === 'xlsx'}
                onClick={() => { formularioTocado.current = true; setFormato('xlsx'); }}
                icone={<FileSpreadsheet size={18} />}
                titulo="Arquivo único (.xlsx)"
                descricao="Aba Resumo + uma aba por servidor no mesmo arquivo."
              />
              <FormatoBtn
                ativo={formato === 'zip'}
                onClick={() => { formularioTocado.current = true; setFormato('zip'); }}
                icone={<FileArchive size={18} />}
                titulo="Um arquivo por servidor (.zip)"
                descricao="Resumo.xlsx + cada planilha nomeada com o servidor."
              />
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
              <input
                type="checkbox"
                checked={reduzida}
                onChange={(e) => { formularioTocado.current = true; setReduzida(e.target.checked); }}
                className="mt-0.5 h-4 w-4 accent-navy-800"
              />
              <span className="text-sm">
                <span className="font-semibold text-ink">Planilha reduzida</span>
                <span className="block text-xs text-slate-600">
                  Só número do processo, dígito, etiquetas e dias parados.
                </span>
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={handleGerar}
            disabled={iniciando || atribuicoesValidas.length === 0}
            className="btn btn-emerald w-full py-3 text-sm"
          >
            {iniciando
              ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</>
              : <><Hash size={16} /> Gerar planilha por dígito</>}
          </button>
          {atribuicoesValidas.length === 0 && (
            <p className="-mt-4 text-center text-xs text-slate-600">
              Atribua ao menos um dígito a um servidor para gerar.
            </p>
          )}
        </>
      )}

      <BarraStatusFixa
        visivel={barraAtiva}
        mensagem={barraMensagem}
        progresso={barraProgresso}
        onVer={() => rolarAte(etiquetagemAtiva ? etiquetagemRef.current : progressoRef.current)}
        onCancelar={etiquetagemAtiva
          ? (etiquetagem?.status !== 'cancelling' ? handleCancelarEtq : undefined)
          : (jobAtivo && job?.status !== 'cancelling' ? handleCancelar : undefined)}
      />
    </div>
  );
}

function SeletorEtiqueta({ etiquetas, selecionada, onSelecionar, donoDe, rotulo }: {
  etiquetas: EtiquetaPJE[];
  selecionada?: EtiquetaPJE;
  onSelecionar: (e: EtiquetaPJE | undefined) => void;
  donoDe: (id: number) => string | null;
  rotulo: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fechar);
    return () => document.removeEventListener('mousedown', fechar);
  }, [aberto]);

  const filtradas = useMemo(() => {
    const validas = etiquetas.filter((e) => e != null);
    if (!busca.trim()) return validas.slice(0, 200);
    const t = busca.toLowerCase();
    return validas.filter((e) =>
      safeStr(e.nomeTag).toLowerCase().includes(t) || safeStr(e.nomeTagCompleto).toLowerCase().includes(t),
    ).slice(0, 200);
  }, [etiquetas, busca]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={aberto}
          aria-label={`Etiqueta de ${rotulo}`}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
            selecionada ? 'border-navy-300 bg-navy-50 text-navy-800' : 'border-dashed border-slate-300 bg-white text-slate-500 hover:border-navy-400'
          }`}
        >
          <Tag size={14} className="shrink-0" aria-hidden />
          <span className="truncate">{selecionada ? safeStr(selecionada.nomeTag) : 'Vincular etiqueta do servidor (opcional)'}</span>
          <ChevronDown size={14} className="ml-auto shrink-0" aria-hidden />
        </button>
        {selecionada && (
          <button type="button" onClick={() => onSelecionar(undefined)} className="btn btn-ghost shrink-0 px-2.5 py-2" aria-label="Remover etiqueta">
            <X size={14} />
          </button>
        )}
      </div>

      {aberto && (
        <div className="absolute z-20 mt-1.5 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-lg" role="listbox" aria-label={`Etiquetas para ${rotulo}`}>
          <CampoBusca valor={busca} onChange={setBusca} placeholder="Buscar etiqueta…" />
          <div className="scroll-area mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
            {filtradas.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-slate-500">{busca ? 'Nenhuma encontrada.' : 'Nenhuma etiqueta disponível.'}</p>
            )}
            {filtradas.map((etq, idx) => {
              const on = selecionada?.id === etq.id;
              const dono = donoDe(etq.id);
              return (
                <button
                  key={`etq-${etq.id}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => { onSelecionar(etq); setAberto(false); setBusca(''); }}
                  className={`row flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${on ? 'row-on' : ''}`}
                  title={dono ? `Vinculada a ${dono} — clique para trazer para cá` : undefined}
                >
                  <Tag size={13} className={`shrink-0 ${dono ? 'text-slate-400' : 'text-navy-700'}`} aria-hidden />
                  <span className={`truncate ${dono ? 'text-slate-400' : ''}`}>{safeStr(etq.nomeTag)}</span>
                  {dono && <span className="ml-auto shrink-0 text-[11px] text-slate-400">{dono}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Fica recolhido de propósito: quase ninguém precisa mexer nisso.
function FilasDeEspera({ termos, personalizado, tarefas, onChange, onRestaurar }: {
  termos: string[];
  personalizado: boolean;
  tarefas: TarefaPJE[];
  onChange: (termos: string[]) => void;
  onRestaurar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState('');

  const termosNorm = useMemo(() => termos.map(normalizar).filter(Boolean), [termos]);
  const tarefasEmFila = useMemo(
    () => tarefas.filter((t) => { const n = normalizar(t.nome); return termosNorm.some((p) => n.includes(p)); }),
    [tarefas, termosNorm],
  );

  const adicionar = () => {
    const termo = novo.trim();
    if (!termo) return;
    if (!termosNorm.includes(normalizar(termo))) onChange([...termos, termo]);
    setNovo('');
  };
  const remover = (termo: string) => onChange(termos.filter((t) => t !== termo));

  return (
    <div className="rounded-2xl border border-dashed border-slate-200">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-slate-600 hover:text-ink"
      >
        <Hourglass size={14} className="shrink-0 text-slate-500" aria-hidden />
        <span>
          Filas de espera · {termos.length} termo(s) · {tarefasEmFila.length} tarefa(s) do painel
          {personalizado && <span className="ml-1.5 chip bg-brass-50 text-brass-600">personalizado</span>}
        </span>
        {aberto ? <ChevronUp size={14} className="ml-auto shrink-0" aria-hidden /> : <ChevronDown size={14} className="ml-auto shrink-0" aria-hidden />}
      </button>

      {aberto && (
        <div className="space-y-3 border-t border-dashed border-slate-200 px-4 py-3 text-xs">
          <p className="text-slate-600">
            Tarefa cujo nome contém um destes termos vira <strong>fila de espera</strong>: o processo
            perde peso e não conta como trabalhável. Termos comparados sem acento nem maiúsculas.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {termos.map((t) => (
              <span key={t} className="chip bg-slate-100 text-slate-700">
                {t}
                <button type="button" onClick={() => remover(t)} className="ml-0.5 text-slate-400 hover:text-red-600" aria-label={`Remover termo ${t}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
            {termos.length === 0 && <span className="text-slate-500">Nenhum termo: nenhuma tarefa será fila de espera.</span>}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }}
              list="tarefas-painel-fila"
              placeholder="Novo termo ou nome de tarefa do painel"
              aria-label="Novo termo de fila de espera"
              className="field flex-1"
            />
            <datalist id="tarefas-painel-fila">
              {tarefas.filter((t) => !tarefasEmFila.includes(t)).map((t) => <option key={t.id} value={t.nome} />)}
            </datalist>
            <button type="button" onClick={adicionar} disabled={!novo.trim()} className="btn btn-ghost shrink-0 px-3 py-2 text-xs">
              <Plus size={13} /> Adicionar
            </button>
            {personalizado && (
              <button type="button" onClick={onRestaurar} className="btn btn-ghost shrink-0 px-3 py-2 text-xs">
                <RotateCcw size={13} /> Padrão
              </button>
            )}
          </div>
          {tarefasEmFila.length > 0 && (
            <details className="text-slate-600">
              <summary className="cursor-pointer select-none">Tarefas do painel classificadas hoje ({tarefasEmFila.length})</summary>
              <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto pl-4 scroll-area">
                {tarefasEmFila.map((t) => <li key={t.id} className="list-disc">{t.nome}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ResumoEtiquetagem({ etiquetagem }: { etiquetagem: EtiquetagemDigitoProgress }) {
  const erros = etiquetagem.processos.filter((p) => p.acao === 'erro');
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Resultado da etiquetagem</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip bg-emerald-50 text-emerald-700">Inseridas: <strong>{etiquetagem.inseridas}</strong></span>
          <span className="chip bg-brass-50 text-brass-600">Removidas: <strong>{etiquetagem.removidas}</strong></span>
          <span className={`chip ${etiquetagem.erros > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>Erros: <strong>{etiquetagem.erros}</strong></span>
        </div>
      </div>
      {erros.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50/60 p-4 text-xs text-slate-700">
          <p className="mb-1.5 font-semibold text-ink">Alterações que falharam ({erros.length})</p>
          <div className="scroll-area max-h-56 space-y-1 overflow-y-auto pr-1">
            {erros.slice(0, 100).map((p, i) => (
              <p key={`${p.idProcesso}-${p.etiqueta}-${i}`}>
                <span className="font-mono">{p.numeroProcesso}</span> · {p.etiqueta}: {p.erro}
              </p>
            ))}
            {erros.length > 100 && <p className="text-slate-500">… e mais {erros.length - 100}.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function FormatoBtn({ ativo, onClick, icone, titulo, descricao }: {
  ativo: boolean; onClick: () => void; icone: React.ReactNode; titulo: string; descricao: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} className={`pick p-4 text-left ${ativo ? 'pick-on' : ''}`}>
      <span className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${ativo ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-700'}`} aria-hidden>
        {icone}
      </span>
      <h4 className="text-sm font-semibold text-ink">{titulo}</h4>
      <p className="mt-0.5 text-xs text-slate-600">{descricao}</p>
    </button>
  );
}

function ResumoDistribuicao({ resumo, comEtiquetagem }: { resumo: PlanilhaDigitoResumo; comEtiquetagem: boolean }) {
  const pendencias = resumo.naoAtribuidos.total > 0 || resumo.semEtiquetaServidor > 0 || resumo.etiquetaDivergente > 0;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Distribuição</p>
        <div className="flex flex-wrap gap-1.5">
          {resumo.porServidor.map((s) => (
            <span key={s.servidor} className="chip bg-navy-50 text-navy-700">
              {s.servidor} (dígitos {s.digitos.join(', ')}): <strong>{s.total}</strong>
            </span>
          ))}
          {resumo.filasEspera > 0 && (
            <span className="chip bg-slate-100 text-slate-600">
              Filas de espera: <strong>{resumo.filasEspera}</strong>
            </span>
          )}
          {resumo.naoAtribuidos.total > 0 && (
            <span className="chip bg-brass-50 text-brass-600">
              Não atribuídos: <strong>{resumo.naoAtribuidos.total}</strong>
            </span>
          )}
        </div>
      </div>

      {resumo.metasAUmPasso.length > 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">Metas a um passo de zerar</p>
          <div className="space-y-1 text-xs leading-relaxed text-slate-700">
            {resumo.metasAUmPasso.map((m) => (
              <p key={m.meta}>
                A Meta <strong>{m.meta}</strong> será concluída com o saneamento de apenas{' '}
                <strong>{m.restantes}</strong> processo(s): {m.processos.join(', ')}
              </p>
            ))}
          </div>
        </div>
      )}

      {pendencias && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-brass-200 bg-brass-50/60 p-4 text-sm text-slate-700">
          <Tags size={16} className="mt-0.5 flex-shrink-0 text-brass-500" aria-hidden />
          <div className="space-y-1.5 text-xs leading-relaxed">
            <p className="font-semibold text-ink">Pendências de etiquetagem encontradas</p>
            {resumo.naoAtribuidos.digitosSemServidor.length > 0 && (
              <p>• Dígito(s) <strong>{resumo.naoAtribuidos.digitosSemServidor.join(', ')}</strong> sem servidor atribuído — os processos estão na aba/arquivo &quot;Não atribuídos&quot;.</p>
            )}
            {resumo.semEtiquetaServidor > 0 && (
              <p>• <strong>{resumo.semEtiquetaServidor}</strong> processo(s) sem a etiqueta do servidor responsável no PJE.</p>
            )}
            {resumo.etiquetaDivergente > 0 && (
              <p>• <strong>{resumo.etiquetaDivergente}</strong> processo(s) com etiqueta apontando para outro servidor (flag DIGITO_DIVERGENTE) — o cálculo pelo dígito prevalece.</p>
            )}
            {resumo.malformados > 0 && (
              <p>• <strong>{resumo.malformados}</strong> processo(s) com número fora do padrão CNJ.</p>
            )}
            <p className="pt-1 text-slate-600">
              {comEtiquetagem
                ? 'Corrija direto daqui com o bloco "Etiquetar processos no PJE" logo abaixo.'
                : 'Para corrigir direto daqui, vincule a etiqueta de cada servidor antes de gerar a planilha.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
