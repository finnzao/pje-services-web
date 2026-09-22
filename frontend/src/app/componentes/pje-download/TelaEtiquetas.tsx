'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, ChevronDown, ChevronUp, Download, FlaskConical, History, Info,
  Loader2, RotateCcw, ShieldAlert, SlidersHorizontal, Tag, Tags, Eye,
} from 'lucide-react';
import { BarraStatusFixa } from './BarraStatusFixa';
import { ListaEtiquetas } from './ListaEtiquetas';
import { ListaTarefas, type TarefaSelecionada } from './ListaTarefas';
import { ProgressoJob } from './ProgressoJob';
import { notificar } from './Toast';
import {
  normalizarStatus, notificarNavegador, pedirPermissaoNotificacao, rolarAte, useRolarNoProgresso, useTituloAba,
} from './feedback';
import type { EtiquetaPJE, TarefaPJE } from './types';
import { safeStr } from './types';
import {
  cancelarExecucaoEtiquetas, downloadPlanilhaExecucao, executarEtiquetagem, listarExecucoesEtiquetas,
  obterConfigEtiquetas, obterExecucaoEtiquetas, salvarConfigEtiquetas,
  type ExecucaoEtiquetas, type ExecucaoResumo, type MotivoIgnorado, type ProcessoAfetado,
} from './api-etiquetas';

const DIAS_PADRAO = 120;
const DIAS_PRESETS = [60, 90, 120, 180, 365];
const POLL_INTERVAL_MS = 2500;
const TERMINAIS = ['completed', 'failed', 'cancelled'];
const LINHAS_INICIAIS = 50;
const LINHAS_INCREMENTO = 100;

const ROTULO_ETAPA: Record<ExecucaoEtiquetas['etapa'], string> = {
  sessao: 'Sessão', listando: 'Listando', enriquecendo: 'Movimentações', aplicando: 'Aplicando', concluido: 'Concluído',
};

const ROTULO_MOTIVO: Record<MotivoIgnorado, string> = {
  TAREFA_IGNORADA: 'em tarefa ignorada',
  SEM_DATA_MOVIMENTO: 'sem data de movimentação',
  DENTRO_DO_PRAZO: 'dentro do prazo',
  JA_ETIQUETADO: 'já etiquetados',
  LIMITE_EXECUCAO: 'acima do teto por execução',
};

const ROTULO_ACAO: Record<ProcessoAfetado['acao'], { texto: string; classe: string; simbolo: string }> = {
  inserida: { texto: 'Etiquetada', classe: 'bg-emerald-50 text-emerald-700', simbolo: '✓' },
  removida: { texto: 'Removida', classe: 'bg-navy-50 text-navy-700', simbolo: '−' },
  simulada_insercao: { texto: 'Seria etiquetada', classe: 'bg-brass-50 text-brass-600', simbolo: '○' },
  simulada_remocao: { texto: 'Seria removida', classe: 'bg-slate-100 text-slate-600', simbolo: '○' },
  erro: { texto: 'Erro', classe: 'bg-red-50 text-red-700', simbolo: '!' },
};

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface TelaEtiquetasProps {
  sessionId: string;
  tarefas: TarefaPJE[];
  etiquetas: EtiquetaPJE[];
  credenciais: { cpf: string; password: string } | null;
  perfilIndice?: number;
}

export function TelaEtiquetas({ sessionId, tarefas, etiquetas, credenciais, perfilIndice }: TelaEtiquetasProps) {
  const [diasParado, setDiasParado] = useState<number>(DIAS_PADRAO);
  const [etiquetaId, setEtiquetaId] = useState<number | null>(null);
  const [ignoradas, setIgnoradas] = useState<TarefaSelecionada[]>([]);
  const [removerQuandoMovimentado, setRemoverQuandoMovimentado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [execucao, setExecucao] = useState<ExecucaoEtiquetas | null>(null);
  /** Uma simulação concluída com os parâmetros atuais libera o botão de escrita. */
  const [simulacaoValida, setSimulacaoValida] = useState(false);
  const [historico, setHistorico] = useState<ExecucaoResumo[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressoRef = useRef<HTMLDivElement | null>(null);
  const statusAnterior = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const carregarHistorico = useCallback(() => {
    listarExecucoesEtiquetas().then(setHistorico).catch(() => { /* histórico é opcional */ });
  }, []);

  // Pré-preenche com a última configuração salva no backend (é a mesma que a rotina automática usará).
  useEffect(() => {
    let ativo = true;
    obterConfigEtiquetas().then((cfg) => {
      if (!ativo) return;
      if (Number.isInteger(cfg.diasParado) && cfg.diasParado > 0) setDiasParado(cfg.diasParado);
      if (cfg.etiqueta && etiquetas.some((e) => e.id === cfg.etiqueta!.id)) setEtiquetaId(cfg.etiqueta.id);
      const nomesPainel = new Set(tarefas.map((t) => t.nome.trim().toLowerCase()));
      setIgnoradas(cfg.tarefasIgnoradas
        .filter((n) => nomesPainel.has(n.trim().toLowerCase()))
        .map((n) => ({ nome: tarefas.find((t) => t.nome.trim().toLowerCase() === n.trim().toLowerCase())?.nome ?? n, favorita: false })));
      setRemoverQuandoMovimentado(cfg.removerQuandoMovimentado === true);
    }).catch(() => { /* sem configuração salva: fica o padrão */ });
    carregarHistorico();
    return () => { ativo = false; };
  }, [etiquetas, tarefas, carregarHistorico]);

  // Qualquer mudança de parâmetro invalida a simulação anterior.
  useEffect(() => { setSimulacaoValida(false); }, [diasParado, etiquetaId, ignoradas, removerQuandoMovimentado]);

  const etiquetaSelecionada = useMemo(
    () => etiquetas.find((e) => e.id === etiquetaId) ?? null,
    [etiquetas, etiquetaId],
  );

  const diasValido = Number.isInteger(diasParado) && diasParado >= 1 && diasParado <= 3650;
  const pronto = diasValido && !!etiquetaSelecionada;
  const statusUi = normalizarStatus(execucao?.status);
  const execucaoAtiva = statusUi === 'running';

  useTituloAba(statusUi, execucao?.progresso, 'Etiquetas');
  useRolarNoProgresso(progressoRef, statusUi);

  // Sinais de conclusão fora do fluxo de rolagem: toast, notificação e liberação da escrita.
  useEffect(() => {
    const atual = execucao?.status ?? null;
    const antes = statusAnterior.current;
    statusAnterior.current = atual;
    if (!execucao || antes !== 'running' || !atual || !TERMINAIS.includes(atual)) return;

    const t = execucao.totais;
    if (atual === 'completed') {
      const titulo = execucao.dryRun
        ? `Simulação concluída: ${t.candidatos} processo(s) seriam etiquetados`
        : `Etiquetagem concluída: ${t.inseridas} etiquetado(s)${t.erros ? `, ${t.erros} erro(s)` : ''}`;
      notificar({ tom: t.erros > 0 ? 'info' : 'sucesso', titulo, acao: { rotulo: 'Ver resultado', onClick: () => rolarAte(progressoRef.current) } });
      notificarNavegador('Fórum Hub — Etiquetas', titulo);
      if (execucao.dryRun) setSimulacaoValida(true);
    } else if (atual === 'failed') {
      notificar({ tom: 'erro', titulo: 'A etiquetagem falhou', descricao: execucao.erro, acao: { rotulo: 'Ver detalhes', onClick: () => rolarAte(progressoRef.current) } });
      notificarNavegador('Fórum Hub — Etiquetas', 'A etiquetagem falhou.');
    } else {
      notificar({ tom: 'info', titulo: 'Etiquetagem cancelada' });
    }
    carregarHistorico();
  }, [execucao, carregarHistorico]);

  const toggleIgnorada = useCallback((nome: string, favorita: boolean) => {
    setIgnoradas((prev) => {
      const existe = prev.some((t) => t.nome === nome);
      return existe ? prev.filter((t) => t.nome !== nome) : [...prev, { nome, favorita }];
    });
  }, []);

  const startPolling = useCallback((id: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const e = await obterExecucaoEtiquetas(id);
        setExecucao(e);
        if (TERMINAIS.includes(e.status)) stopPolling();
      } catch { /* falha transitória: próxima rodada tenta de novo */ }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const iniciar = useCallback(async (dryRun: boolean) => {
    if (!etiquetaSelecionada || !diasValido) return;
    setErro(null);
    setConfirmando(false);
    setIniciando(true);
    setExecucao(null);
    pedirPermissaoNotificacao();
    try {
      await salvarConfigEtiquetas({
        diasParado,
        etiqueta: { id: etiquetaSelecionada.id, nome: etiquetaSelecionada.nomeTag },
        tarefasIgnoradas: ignoradas.map((t) => t.nome),
        removerQuandoMovimentado,
        pjeSessionId: sessionId,
        pjeProfileIndex: perfilIndice,
      });
      const { execucaoId } = await executarEtiquetagem({
        dryRun,
        pjeSessionId: sessionId,
        credentials: credenciais ?? undefined,
        pjeProfileIndex: perfilIndice,
      });
      setExecucao(await obterExecucaoEtiquetas(execucaoId).catch(() => ({
        id: execucaoId, origem: 'manual', dryRun, status: 'running', etapa: 'sessao', progresso: 0,
        mensagem: 'Iniciando...', iniciadoEm: new Date().toISOString(),
        totais: {
          tarefasConsideradas: 0, tarefasIgnoradas: 0, processosListados: 0, candidatos: 0,
          inseridas: 0, removidas: 0, erros: 0,
          ignorados: { TAREFA_IGNORADA: 0, SEM_DATA_MOVIMENTO: 0, DENTRO_DO_PRAZO: 0, JA_ETIQUETADO: 0, LIMITE_EXECUCAO: 0 },
        },
        processos: [],
        configSnapshot: {
          diasParado, etiqueta: { id: etiquetaSelecionada.id, nome: etiquetaSelecionada.nomeTag },
          tarefasIgnoradas: ignoradas.map((t) => t.nome), removerQuandoMovimentado, limitePorExecucao: 500,
        },
      } satisfies ExecucaoEtiquetas)));
      startPolling(execucaoId);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao iniciar a etiquetagem');
    } finally {
      setIniciando(false);
    }
  }, [etiquetaSelecionada, diasValido, diasParado, ignoradas, removerQuandoMovimentado, sessionId, perfilIndice, credenciais, startPolling]);

  const handleCancelar = useCallback(async () => {
    if (!execucao) return;
    setExecucao((e) => e ? { ...e, mensagem: 'Cancelando...' } : e);
    try { await cancelarExecucaoEtiquetas(execucao.id); } catch { /* polling reflete o estado real */ }
  }, [execucao]);

  const voltarAoFormulario = useCallback(() => {
    stopPolling();
    setExecucao(null);
    setConfirmando(false);
    statusAnterior.current = null;
  }, [stopPolling]);

  const abrirDoHistorico = useCallback(async (id: string) => {
    try {
      setExecucao(await obterExecucaoEtiquetas(id));
      statusAnterior.current = null;
      setTimeout(() => rolarAte(progressoRef.current), 50);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível abrir a execução.');
    }
  }, []);

  const processados = execucao ? execucao.processos.length : 0;
  const resumoParametros = etiquetaSelecionada
    ? `"${etiquetaSelecionada.nomeTag}" · mais de ${diasParado} dias${ignoradas.length ? ` · ${ignoradas.length} tarefa(s) ignorada(s)` : ''}${removerQuandoMovimentado ? ' · remove ao movimentar' : ''}`
    : '';

  const painelConfirmacao = (
    <div className="space-y-3 rounded-2xl border border-brass-200 bg-brass-50/60 p-4" role="alertdialog" aria-labelledby="confirma-titulo">
      <div className="flex items-start gap-2.5 text-sm text-slate-700">
        <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-brass-500" aria-hidden />
        <div className="space-y-1 text-xs leading-relaxed">
          <p id="confirma-titulo" className="text-sm font-semibold text-ink">Esta ação altera os processos no PJE.</p>
          <p>
            A etiqueta <strong>{etiquetaSelecionada?.nomeTag}</strong> será aplicada em todos os
            processos do painel parados há mais de <strong>{diasParado} dias</strong>
            {ignoradas.length > 0 && <> (exceto os vinculados a {ignoradas.length} tarefa(s) ignorada(s))</>}
            {removerQuandoMovimentado && <>, e removida dos que voltaram a movimentar</>}.
          </p>
          {execucao?.dryRun && execucao.status === 'completed' && (
            <p>A simulação encontrou <strong>{execucao.totais.candidatos}</strong> processo(s).</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => setConfirmando(false)} className="btn btn-ghost flex-1 py-2.5 text-sm" autoFocus>
          Voltar
        </button>
        <button
          type="button"
          onClick={() => iniciar(false)}
          disabled={iniciando || !pronto}
          className="btn btn-brass flex-1 py-2.5 text-sm"
        >
          {iniciando ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</> : <><Tags size={16} /> Confirmar e etiquetar</>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      {erro && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" aria-hidden />
          <span>{erro}</span>
        </div>
      )}

      {/* ───── Vista de execução/resultado (separada do formulário) ───── */}
      {execucao && (
        <div ref={progressoRef} className="scroll-mt-24 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="num-badge">{execucaoAtiva ? '⏳' : '✓'}</span>
              <span className="eyebrow">{execucao.dryRun ? 'Simulação' : 'Etiquetagem'} · {formatarDataHora(execucao.iniciadoEm)}</span>
            </div>
            {!execucaoAtiva && (
              <div className="flex gap-2">
                <button type="button" onClick={voltarAoFormulario} className="btn btn-ghost px-3 py-1.5 text-xs">
                  <SlidersHorizontal size={13} /> Ajustar parâmetros
                </button>
                <button type="button" onClick={voltarAoFormulario} className="btn btn-ghost px-3 py-1.5 text-xs">
                  <RotateCcw size={13} /> Nova execução
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-slate-600">
            Parâmetros: etiqueta <strong>{execucao.configSnapshot.etiqueta?.nome}</strong> · mais de{' '}
            <strong>{execucao.configSnapshot.diasParado} dias</strong>
            {execucao.configSnapshot.tarefasIgnoradas.length > 0 && <> · {execucao.configSnapshot.tarefasIgnoradas.length} tarefa(s) ignorada(s)</>}
          </p>

          <ProgressoJob
            status={execucao.status}
            progress={execucao.progresso}
            message={`${ROTULO_ETAPA[execucao.etapa]}: ${execucao.mensagem}`}
            processedCount={processados}
            totalProcesses={execucao.totais.candidatos}
            onCancelar={execucaoAtiva ? handleCancelar : undefined}
            confirmarCancelamento={!execucao.dryRun}
          />

          {execucao.status === 'completed' && (
            <ResumoExecucao
              execucao={execucao}
              onAplicar={execucao.dryRun && execucao.totais.candidatos > 0 && !confirmando ? () => setConfirmando(true) : undefined}
            />
          )}

          {confirmando && !execucaoAtiva && painelConfirmacao}
        </div>
      )}

      {/* ───── Formulário ───── */}
      {!execucao && (
        <>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">2</span>
              <span className="eyebrow">Critério de tempo</span>
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-navy-50 px-3.5 py-2.5 text-xs text-navy-700">
              <Info size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span>
                Conta-se a partir da <strong>data da última movimentação</strong> do processo — o
                mesmo critério de &quot;dias parados&quot; da automação por dígito. Serão etiquetados
                os processos parados há <strong>mais de</strong> {diasValido ? diasParado : '…'} dias.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-navy-400">
                <CalendarClock size={16} className="text-navy-600" aria-hidden />
                <span className="sr-only">Dias parados</span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={Number.isNaN(diasParado) ? '' : diasParado}
                  onChange={(e) => setDiasParado(parseInt(e.target.value, 10))}
                  aria-invalid={!diasValido}
                  className="w-20 bg-transparent text-sm font-semibold text-ink outline-none"
                />
                <span className="text-xs text-slate-600">dias</span>
              </label>
              {DIAS_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDiasParado(d)}
                  aria-pressed={diasParado === d}
                  className={`chip transition-colors ${diasParado === d ? 'bg-navy-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {d}{d === DIAS_PADRAO ? ' (padrão)' : ''}
                </button>
              ))}
            </div>
            {!diasValido && <p className="mt-2 text-xs text-red-600" role="alert">Informe um número inteiro entre 1 e 3650.</p>}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">3</span>
              <span className="eyebrow">Etiqueta a aplicar</span>
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-brass-50 px-3.5 py-2.5 text-xs text-brass-600">
              <Info size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span>
                Escolha <strong>uma</strong> etiqueta já existente neste perfil. Processos que já a
                possuem não são etiquetados de novo.
              </span>
            </div>
            <ListaEtiquetas
              etiquetas={etiquetas}
              modo="unica"
              selecionadas={etiquetaId !== null ? [etiquetaId] : []}
              onToggle={(id) => setEtiquetaId((atual) => (atual === id ? null : id))}
            />
            {etiquetaSelecionada && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                <Tag size={12} className="text-navy-600" aria-hidden />
                Selecionada: <strong className="text-ink">{safeStr(etiquetaSelecionada.nomeTagCompleto) || etiquetaSelecionada.nomeTag}</strong>
              </p>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">4</span>
              <span className="eyebrow">Exceções e opções</span>
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-brass-50 px-3.5 py-2.5 text-xs text-brass-600">
              <Info size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span>
                Processos vinculados às tarefas marcadas aqui <strong>nunca</strong> recebem a etiqueta,
                mesmo que ultrapassem o prazo. As demais tarefas do painel formam o acervo analisado.
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
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
              <input
                type="checkbox"
                checked={removerQuandoMovimentado}
                onChange={(e) => setRemoverQuandoMovimentado(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-navy-800"
              />
              <span className="text-sm text-slate-700">
                <span className="font-semibold text-ink">Remover a etiqueta de quem voltou a movimentar</span>
                <span className="mt-0.5 block text-xs text-slate-600">
                  Processos que já têm a etiqueta mas estão dentro do prazo têm a etiqueta removida.
                  Desligado, a etiquetagem só insere.
                </span>
              </span>
            </label>
          </div>

          {confirmando ? painelConfirmacao : (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => iniciar(true)}
                  disabled={iniciando || !pronto}
                  className="btn btn-primary flex-1 py-3 text-sm"
                >
                  {iniciando ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</> : <><FlaskConical size={16} /> Simular (não altera o PJE)</>}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(true)}
                  disabled={iniciando || !pronto || !simulacaoValida}
                  title={!simulacaoValida ? 'Simule primeiro com estes parâmetros' : undefined}
                  className={`btn flex-1 py-3 text-sm ${simulacaoValida ? 'btn-brass' : 'btn-ghost'}`}
                >
                  <Tags size={16} /> Etiquetar processos parados
                </button>
              </div>
              <p className="text-center text-xs text-slate-600">
                {!pronto
                  ? (!etiquetaSelecionada ? 'Selecione a etiqueta a aplicar.' : 'Informe um prazo válido em dias.')
                  : !simulacaoValida
                    ? 'Simule primeiro: a etiquetagem real é liberada após uma simulação com estes parâmetros.'
                    : `Pronto para etiquetar: ${resumoParametros}.`}
              </p>
              <p className="flex items-start justify-center gap-1.5 text-center text-xs text-slate-500">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
                <span>Estes parâmetros ficam salvos como configuração do serviço e serão os mesmos da rotina automática quando ela for ativada.</span>
              </p>
            </div>
          )}
        </>
      )}

      {!execucaoAtiva && historico.length > 0 && (
        <HistoricoExecucoes lista={historico} atualId={execucao?.id} onAbrir={abrirDoHistorico} />
      )}

      <BarraStatusFixa
        visivel={execucaoAtiva}
        etapa={execucao ? ROTULO_ETAPA[execucao.etapa] : undefined}
        mensagem={execucao?.mensagem ?? ''}
        progresso={execucao?.progresso ?? 0}
        onVer={() => rolarAte(progressoRef.current)}
      />
    </div>
  );
}

function ResumoExecucao({ execucao, onAplicar }: { execucao: ExecucaoEtiquetas; onAplicar?: () => void }) {
  const t = execucao.totais;
  const motivos = (Object.keys(t.ignorados) as MotivoIgnorado[]).filter((m) => t.ignorados[m] > 0);
  const comErro = execucao.processos.filter((p) => p.acao === 'erro');
  const [linhas, setLinhas] = useState(LINHAS_INICIAIS);
  useEffect(() => { setLinhas(LINHAS_INICIAIS); }, [execucao.id]);
  const visiveis = execucao.processos.slice(0, linhas);
  const restantes = execucao.processos.length - visiveis.length;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {execucao.dryRun ? 'Resultado da simulação' : 'Resultado da etiquetagem'}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip bg-slate-100 text-slate-600">
            Acervo analisado: <strong>{t.processosListados}</strong> processo(s) em <strong>{t.tarefasConsideradas}</strong> tarefa(s)
          </span>
          {t.tarefasIgnoradas > 0 && (
            <span className="chip bg-slate-100 text-slate-600">Tarefas ignoradas: <strong>{t.tarefasIgnoradas}</strong></span>
          )}
          {execucao.dryRun ? (
            <span className="chip bg-brass-50 text-brass-600">
              Seriam etiquetados: <strong>{execucao.processos.filter((p) => p.acao === 'simulada_insercao').length}</strong>
            </span>
          ) : (
            <span className="chip bg-emerald-50 text-emerald-700">✓ Etiquetados: <strong>{t.inseridas}</strong></span>
          )}
          {(t.removidas > 0 || execucao.processos.some((p) => p.acao === 'simulada_remocao')) && (
            <span className="chip bg-navy-50 text-navy-700">
              {execucao.dryRun ? 'Teriam a etiqueta removida' : 'Etiqueta removida'}:{' '}
              <strong>{execucao.dryRun ? execucao.processos.filter((p) => p.acao === 'simulada_remocao').length : t.removidas}</strong>
            </span>
          )}
          {t.erros > 0 && <span className="chip bg-red-50 text-red-700">! Erros: <strong>{t.erros}</strong></span>}
        </div>
        {motivos.length > 0 && (
          <p className="mt-3 text-xs text-slate-600">
            Fora da ação: {motivos.map((m) => `${t.ignorados[m]} ${ROTULO_MOTIVO[m]}`).join(' · ')}.
          </p>
        )}
      </div>

      {execucao.dryRun && onAplicar && (
        <button type="button" onClick={onAplicar} className="btn btn-brass w-full py-2.5 text-sm">
          <Tags size={16} /> Aplicar agora nos {t.candidatos} processo(s) encontrado(s)
        </button>
      )}

      {comErro.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50/60 p-4 text-xs text-red-700" role="alert">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-red-500" aria-hidden />
          <div>
            <p className="font-semibold">{comErro.length} processo(s) não puderam ser etiquetados.</p>
            <p className="mt-1 text-red-600">Primeiro erro: {comErro[0].numeroProcesso} — {comErro[0].erro}</p>
          </div>
        </div>
      )}

      {execucao.processos.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
            Processos ({execucao.processos.length})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Processo</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Tarefa</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Dias</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => {
                  const rotulo = ROTULO_ACAO[p.acao];
                  return (
                    <tr key={`${p.idProcesso}-${p.acao}`} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-4 py-1.5 font-mono text-xs text-ink">{p.numeroProcesso}</td>
                      <td className="max-w-[16rem] truncate px-2 py-1.5 text-slate-600" title={p.tarefa}>{p.tarefa}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{p.diasParados ?? '—'}</td>
                      <td className="px-4 py-1.5 text-right">
                        <span className={`chip ${rotulo.classe}`} title={p.erro}>{rotulo.simbolo} {rotulo.texto}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {restantes > 0 && (
            <div className="flex flex-col gap-2 border-t border-slate-100 p-3 sm:flex-row">
              <button type="button" onClick={() => setLinhas((n) => n + LINHAS_INCREMENTO)} className="btn btn-ghost flex-1 py-2 text-xs">
                <ChevronDown size={13} /> Mostrar mais {Math.min(LINHAS_INCREMENTO, restantes)} (restam {restantes})
              </button>
              <button type="button" onClick={() => setLinhas(execucao.processos.length)} className="btn btn-ghost flex-1 py-2 text-xs">
                Mostrar todos
              </button>
            </div>
          )}
          <div className="border-t border-slate-100 p-3">
            <BotaoPlanilhaExecucao execucaoId={execucao.id} total={execucao.processos.length} diasParado={execucao.configSnapshot.diasParado} />
          </div>
        </div>
      )}
    </div>
  );
}

function HistoricoExecucoes({ lista, atualId, onAbrir }: { lista: ExecucaoResumo[]; atualId?: string; onAbrir: (id: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const outras = lista.filter((e) => e.id !== atualId);
  if (outras.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <History size={15} className="text-navy-600" aria-hidden /> Execuções anteriores
          <span className="chip bg-slate-100 text-slate-600">{outras.length}</span>
        </span>
        {aberto ? <ChevronUp size={15} className="text-slate-500" aria-hidden /> : <ChevronDown size={15} className="text-slate-500" aria-hidden />}
      </button>
      {aberto && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {outras.map((e) => {
            const t = e.totais;
            const status = e.status === 'completed' ? (e.dryRun ? 'Simulação' : 'Aplicada')
              : e.status === 'failed' ? 'Falhou' : e.status === 'cancelled' ? 'Cancelada' : 'Em andamento';
            const tom = e.status === 'completed' ? (e.dryRun ? 'bg-brass-50 text-brass-600' : 'bg-emerald-50 text-emerald-700')
              : e.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600';
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-xs">
                <span className="chip shrink-0 bg-slate-100 text-slate-600">{e.origem === 'agendada' ? 'automática' : 'manual'}</span>
                <span className={`chip shrink-0 ${tom}`}>{status}</span>
                <span className="text-slate-600">{formatarDataHora(e.iniciadoEm)}</span>
                <span className="text-slate-600">
                  etiqueta <strong className="text-ink">{e.configSnapshot.etiqueta?.nome ?? '?'}</strong> · &gt; {e.configSnapshot.diasParado} d
                </span>
                {e.status === 'completed' && (
                  <span className="text-slate-600">
                    {e.dryRun ? `${t.candidatos} encontrado(s)` : `${t.inseridas} etiquetado(s)${t.erros ? `, ${t.erros} erro(s)` : ''}`}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => onAbrir(e.id)} className="btn btn-ghost px-2.5 py-1 text-xs">
                    <Eye size={12} /> Ver
                  </button>
                  {e.status !== 'running' && (
                    <button type="button" onClick={() => { void downloadPlanilhaExecucao(e.id); }} className="btn btn-ghost px-2.5 py-1 text-xs">
                      <Download size={12} /> Planilha
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BotaoPlanilhaExecucao({ execucaoId, total, diasParado }: { execucaoId: string; total: number; diasParado: number }) {
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleDownload = async () => {
    setBaixando(true);
    setErro(null);
    try { await downloadPlanilhaExecucao(execucaoId); }
    catch (err) { setErro(err instanceof Error ? err.message : 'Erro ao baixar planilha'); }
    finally { setBaixando(false); }
  };

  return (
    <div>
      <button type="button" onClick={handleDownload} disabled={baixando} className="btn btn-primary w-full py-2.5 text-sm">
        {baixando
          ? <><Loader2 size={16} className="animate-spin" /> Gerando planilha…</>
          : <><Download size={16} /> Baixar planilha dos {total} processo(s) parados há mais de {diasParado} dias</>}
      </button>
      {erro && <p className="mt-2 text-center text-xs text-red-600" role="alert">{erro}</p>}
    </div>
  );
}
