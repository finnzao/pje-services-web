'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Download, FlaskConical, Info, Loader2, ShieldAlert, Tag, Tags,
} from 'lucide-react';
import { ListaEtiquetas } from './ListaEtiquetas';
import { ListaTarefas, type TarefaSelecionada } from './ListaTarefas';
import { ProgressoJob } from './ProgressoJob';
import type { EtiquetaPJE, TarefaPJE } from './types';
import { safeStr } from './types';
import {
  cancelarExecucaoEtiquetas, downloadPlanilhaExecucao, executarEtiquetagem, obterConfigEtiquetas,
  obterExecucaoEtiquetas, salvarConfigEtiquetas,
  type ExecucaoEtiquetas, type MotivoIgnorado, type ProcessoAfetado,
} from './api-etiquetas';

const DIAS_PADRAO = 120;
const DIAS_PRESETS = [60, 90, 120, 180, 365];
const POLL_INTERVAL_MS = 2500;
const TERMINAIS = ['completed', 'failed', 'cancelled'];

const ROTULO_MOTIVO: Record<MotivoIgnorado, string> = {
  TAREFA_IGNORADA: 'em tarefa ignorada',
  SEM_DATA_MOVIMENTO: 'sem data de movimentação',
  DENTRO_DO_PRAZO: 'dentro do prazo',
  JA_ETIQUETADO: 'já etiquetados',
  LIMITE_EXECUCAO: 'acima do teto por execução',
};

const ROTULO_ACAO: Record<ProcessoAfetado['acao'], { texto: string; classe: string }> = {
  inserida: { texto: 'Etiquetada', classe: 'bg-emerald-50 text-emerald-700' },
  removida: { texto: 'Removida', classe: 'bg-navy-50 text-navy-700' },
  simulada_insercao: { texto: 'Seria etiquetada', classe: 'bg-brass-50 text-brass-600' },
  simulada_remocao: { texto: 'Seria removida', classe: 'bg-slate-100 text-slate-600' },
  erro: { texto: 'Erro', classe: 'bg-red-50 text-red-700' },
};

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

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
    return () => { ativo = false; };
  }, [etiquetas, tarefas]);

  const etiquetaSelecionada = useMemo(
    () => etiquetas.find((e) => e.id === etiquetaId) ?? null,
    [etiquetas, etiquetaId],
  );

  const diasValido = Number.isInteger(diasParado) && diasParado >= 1 && diasParado <= 3650;
  const pronto = diasValido && !!etiquetaSelecionada;

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

  const execucaoAtiva = !!execucao && !TERMINAIS.includes(execucao.status);
  const processados = execucao ? execucao.processos.length : 0;

  return (
    <div className="space-y-8">
      {erro && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
          <span>{erro}</span>
        </div>
      )}

      {execucao && (
        <div>
          <ProgressoJob
            status={execucao.status}
            progress={execucao.progresso}
            message={execucao.mensagem}
            processedCount={processados}
            totalProcesses={execucao.totais.candidatos}
            onCancelar={execucaoAtiva ? handleCancelar : undefined}
          />
          {execucao.status === 'completed' && (
            <ResumoExecucao
              execucao={execucao}
              onAplicar={execucao.dryRun && execucao.totais.candidatos > 0 ? () => setConfirmando(true) : undefined}
            />
          )}
        </div>
      )}

      {!execucaoAtiva && (
        <>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">2</span>
              <span className="eyebrow">Dias parados</span>
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-navy-50 px-3.5 py-2.5 text-xs text-navy-700">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Conta-se a partir da <strong>data da última movimentação</strong> do processo — o
                mesmo critério de &quot;dias parados&quot; da planilha por dígito. Serão etiquetados
                os processos parados há <strong>mais de</strong> {diasValido ? diasParado : '…'} dias.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-navy-400">
                <CalendarClock size={16} className="text-navy-600" />
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={Number.isNaN(diasParado) ? '' : diasParado}
                  onChange={(e) => setDiasParado(parseInt(e.target.value, 10))}
                  className="w-20 bg-transparent text-sm font-semibold text-ink outline-none"
                />
                <span className="text-xs text-slate-500">dias</span>
              </label>
              {DIAS_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDiasParado(d)}
                  className={`chip transition-colors ${diasParado === d ? 'bg-navy-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {d}{d === DIAS_PADRAO ? ' (padrão)' : ''}
                </button>
              ))}
            </div>
            {!diasValido && <p className="mt-2 text-xs text-red-600">Informe um número inteiro entre 1 e 3650.</p>}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">3</span>
              <span className="eyebrow">Etiqueta a aplicar</span>
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-brass-50 px-3.5 py-2.5 text-xs text-brass-600">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Escolha uma etiqueta <strong>já existente</strong> neste perfil. Processos que já a
                possuem não são etiquetados de novo.
              </span>
            </div>
            <ListaEtiquetas
              etiquetas={etiquetas}
              selecionadas={etiquetaId !== null ? [etiquetaId] : []}
              onToggle={(id) => setEtiquetaId((atual) => (atual === id ? null : id))}
            />
            {etiquetaSelecionada && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                <Tag size={12} className="text-navy-600" />
                Selecionada: <strong className="text-ink">{safeStr(etiquetaSelecionada.nomeTagCompleto) || etiquetaSelecionada.nomeTag}</strong>
              </p>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">4</span>
              <span className="eyebrow">Tarefas ignoradas (opcional)</span>
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-brass-50 px-3.5 py-2.5 text-xs text-brass-600">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Processos vinculados a estas tarefas <strong>nunca</strong> recebem a etiqueta,
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
              <p className="mt-2 text-xs text-slate-500">
                {ignoradas.length} tarefa(s) ignorada(s): {ignoradas.map((t) => t.nome).join(' · ')}
              </p>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">5</span>
              <span className="eyebrow">Opções</span>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
              <input
                type="checkbox"
                checked={removerQuandoMovimentado}
                onChange={(e) => setRemoverQuandoMovimentado(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-navy-800"
              />
              <span className="text-sm text-slate-700">
                <span className="font-semibold text-ink">Remover a etiqueta de quem voltou a movimentar</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Processos que já têm a etiqueta mas estão dentro do prazo têm a etiqueta removida.
                  Desligado, a etiquetagem só insere.
                </span>
              </span>
            </label>
          </div>

          {confirmando ? (
            <div className="space-y-3 rounded-2xl border border-brass-200 bg-brass-50/60 p-4">
              <div className="flex items-start gap-2.5 text-sm text-slate-700">
                <ShieldAlert size={18} className="mt-0.5 flex-shrink-0 text-brass-500" />
                <div className="space-y-1 text-xs leading-relaxed">
                  <p className="text-sm font-semibold text-ink">Esta ação altera os processos no PJE.</p>
                  <p>
                    A etiqueta <strong>{etiquetaSelecionada?.nomeTag}</strong> será aplicada em todos os
                    processos do painel parados há mais de <strong>{diasParado} dias</strong>
                    {ignoradas.length > 0 && <> (exceto os vinculados a {ignoradas.length} tarefa(s) ignorada(s))</>}
                    {removerQuandoMovimentado && <>, e removida dos que voltaram a movimentar</>}.
                  </p>
                  {execucao?.dryRun && execucao.status === 'completed' && (
                    <p>A simulação anterior encontrou <strong>{execucao.totais.candidatos}</strong> processo(s).</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => setConfirmando(false)} className="btn btn-ghost flex-1 py-2.5 text-sm">
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => iniciar(false)}
                  disabled={iniciando || !pronto}
                  className="btn btn-emerald flex-1 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {iniciando ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</> : <><Tags size={16} /> Confirmar e etiquetar</>}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => iniciar(true)}
                disabled={iniciando || !pronto}
                className="btn btn-ghost flex-1 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {iniciando ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</> : <><FlaskConical size={16} /> Simular (não altera o PJE)</>}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                disabled={iniciando || !pronto}
                className="btn btn-emerald flex-1 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Tags size={16} /> Etiquetar processos parados
              </button>
            </div>
          )}
          {!pronto && (
            <p className="-mt-4 text-center text-xs text-slate-400">
              {!etiquetaSelecionada ? 'Selecione a etiqueta a aplicar.' : 'Informe um prazo válido em dias.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ResumoExecucao({ execucao, onAplicar }: { execucao: ExecucaoEtiquetas; onAplicar?: () => void }) {
  const t = execucao.totais;
  const motivos = (Object.keys(t.ignorados) as MotivoIgnorado[]).filter((m) => t.ignorados[m] > 0);
  const comErro = execucao.processos.filter((p) => p.acao === 'erro');

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
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
            <span className="chip bg-emerald-50 text-emerald-700">Etiquetados: <strong>{t.inseridas}</strong></span>
          )}
          {(t.removidas > 0 || execucao.processos.some((p) => p.acao === 'simulada_remocao')) && (
            <span className="chip bg-navy-50 text-navy-700">
              {execucao.dryRun ? 'Teriam a etiqueta removida' : 'Etiqueta removida'}:{' '}
              <strong>{execucao.dryRun ? execucao.processos.filter((p) => p.acao === 'simulada_remocao').length : t.removidas}</strong>
            </span>
          )}
          {t.erros > 0 && <span className="chip bg-red-50 text-red-700">Erros: <strong>{t.erros}</strong></span>}
        </div>
        {motivos.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Fora da ação: {motivos.map((m) => `${t.ignorados[m]} ${ROTULO_MOTIVO[m]}`).join(' · ')}.
          </p>
        )}
      </div>

      {execucao.dryRun && onAplicar && (
        <button type="button" onClick={onAplicar} className="btn btn-emerald w-full py-2.5 text-sm">
          <Tags size={16} /> Aplicar agora nos {t.candidatos} processo(s) encontrado(s)
        </button>
      )}

      {comErro.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50/60 p-4 text-xs text-red-700">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
          <div>
            <p className="font-semibold">{comErro.length} processo(s) não puderam ser etiquetados.</p>
            <p className="mt-1 text-red-600">Primeiro erro: {comErro[0].numeroProcesso} — {comErro[0].erro}</p>
          </div>
        </div>
      )}

      {execucao.processos.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Processos ({execucao.processos.length})
          </p>
          <div className="scroll-area max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Processo</th>
                  <th className="px-2 py-2 font-semibold">Tarefa</th>
                  <th className="px-2 py-2 text-right font-semibold">Dias</th>
                  <th className="px-4 py-2 text-right font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {execucao.processos.map((p) => {
                  const rotulo = ROTULO_ACAO[p.acao];
                  return (
                    <tr key={`${p.idProcesso}-${p.acao}`} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-4 py-1.5 font-mono text-[11px] text-ink">{p.numeroProcesso}</td>
                      <td className="max-w-[16rem] truncate px-2 py-1.5 text-slate-600" title={p.tarefa}>{p.tarefa}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{p.diasParados ?? '—'}</td>
                      <td className="px-4 py-1.5 text-right">
                        <span className={`chip ${rotulo.classe}`} title={p.erro}>{rotulo.texto}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 p-3">
            <BotaoPlanilhaExecucao execucaoId={execucao.id} total={execucao.processos.length} diasParado={execucao.configSnapshot.diasParado} />
          </div>
        </div>
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
      <button type="button" onClick={handleDownload} disabled={baixando} className="btn btn-primary w-full py-2.5 text-sm disabled:opacity-60">
        {baixando
          ? <><Loader2 size={16} className="animate-spin" /> Gerando planilha…</>
          : <><Download size={16} /> Baixar planilha dos {total} processo(s) parados há mais de {diasParado} dias</>}
      </button>
      {erro && <p className="mt-2 text-center text-xs text-red-600">{erro}</p>}
    </div>
  );
}
