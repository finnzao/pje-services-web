'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, FileArchive, Hash, Info, Loader2, Tags, AlertTriangle, RotateCcw, SlidersHorizontal,
  Plus, Trash2, User,
} from 'lucide-react';
import { BarraStatusFixa } from './BarraStatusFixa';
import { ListaTarefas, type TarefaSelecionada } from './ListaTarefas';
import { ProgressoJob } from './ProgressoJob';
import { notificar } from './Toast';
import {
  normalizarStatus, notificarNavegador, pedirPermissaoNotificacao, rolarAte, useRolarNoProgresso, useTituloAba,
} from './feedback';
import type { TarefaPJE } from './types';
import {
  gerarPlanilhaDigito, obterProgressoDigito, cancelarPlanilhaDigito, downloadPlanilhaDigito,
  type ModoDigito, type PlanilhaDigitoProgress, type PlanilhaDigitoResumo,
} from './api-planilha-digito';

const DIGITOS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const POLL_INTERVAL_MS = 2500;
const TERMINAIS = ['completed', 'failed', 'cancelled'];

interface ServidorDigitos { nome: string; digitos: number[]; }

// Exemplo 8001732-90.2023…: sequencial → 2, verificador1 → 9, verificador2 → 0.
const MODOS_DIGITO: Array<{ valor: ModoDigito; rotulo: string; exemplo: React.ReactNode }> = [
  { valor: 'sequencial', rotulo: 'Último do sequencial', exemplo: <>800173<strong>2</strong>-90.2023</> },
  { valor: 'verificador1', rotulo: '1º dígito verificador', exemplo: <>8001732-<strong>9</strong>0.2023</> },
  { valor: 'verificador2', rotulo: '2º dígito verificador', exemplo: <>8001732-9<strong>0</strong>.2023</> },
];

interface TelaPlanilhaDigitoProps {
  sessionId: string;
  tarefas: TarefaPJE[];
  credenciais: { cpf: string; password: string } | null;
  perfilIndice?: number;
}

export function TelaPlanilhaDigito({ sessionId, tarefas, credenciais, perfilIndice }: TelaPlanilhaDigitoProps) {
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

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const statusUi = normalizarStatus(job?.status);
  const jobAtivo = statusUi === 'running';
  useTituloAba(statusUi, job?.progress, 'Planilha por dígito');
  useRolarNoProgresso(progressoRef, statusUi);

  useEffect(() => {
    const atual = job?.status ?? null;
    const antes = statusAnterior.current;
    statusAnterior.current = atual;
    if (!job || !atual || !TERMINAIS.includes(atual) || antes === null || TERMINAIS.includes(antes)) return;
    if (atual === 'completed') {
      const titulo = `Planilha por dígito pronta: ${job.totalProcesses} processo(s)`;
      notificar({ tom: 'sucesso', titulo, acao: { rotulo: 'Ver resultado', onClick: () => rolarAte(progressoRef.current) } });
      notificarNavegador('Fórum Hub — Planilha por dígito', titulo);
    } else if (atual === 'failed') {
      notificar({ tom: 'erro', titulo: 'A geração da planilha falhou', descricao: job.message, acao: { rotulo: 'Ver detalhes', onClick: () => rolarAte(progressoRef.current) } });
      notificarNavegador('Fórum Hub — Planilha por dígito', 'A geração falhou.');
    } else {
      notificar({ tom: 'info', titulo: 'Geração cancelada' });
    }
  }, [job]);

  const atribuicoesValidas = useMemo(
    () => servidores
      .filter((s) => s.nome.trim())
      .flatMap((s) => s.digitos.map((digito) => ({ digito, servidor: s.nome.trim() }))),
    [servidores],
  );

  const servidoresConhecidos = useMemo(
    () => [...new Set(atribuicoesValidas.map((a) => a.servidor))],
    [atribuicoesValidas],
  );

  const digitosSemServidor = DIGITOS.filter((d) => !atribuicoesValidas.some((a) => a.digito === d));

  const donoDoDigito = (digito: number) => servidores.findIndex((s) => s.digitos.includes(digito));

  const setNome = useCallback((idx: number, nome: string) => {
    setServidores((prev) => prev.map((s, i) => (i === idx ? { ...s, nome } : s)));
  }, []);

  // Um dígito só pode ter um servidor: atribuir aqui tira dos outros.
  const atribuirDigitos = useCallback((idx: number, digitos: number[], remover: boolean) => {
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

  const handleGerar = useCallback(async () => {
    setErro(null);
    setIniciando(true);
    setJob(null);
    pedirPermissaoNotificacao();
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
  }, [credenciais, sessionId, perfilIndice, atribuicoesValidas, ignoradas, formato, reduzida, modoDigito, startPolling]);

  const handleCancelar = useCallback(async () => {
    if (!job) return;
    setJob((p) => p ? { ...p, status: 'cancelling', message: 'Cancelando...' } : null);
    try { await cancelarPlanilhaDigito(job.jobId); } catch { /* progresso reflete o estado real */ }
  }, [job]);

  const voltarAoFormulario = useCallback(() => {
    stopPolling();
    setJob(null);
    statusAnterior.current = null;
  }, [stopPolling]);

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
              <span className="eyebrow">Planilha por dígito · {servidoresConhecidos.length} servidor(es) · {formato === 'zip' ? 'zip por servidor' : 'arquivo único'}{reduzida ? ' · reduzida' : ''}</span>
            </div>
            {!jobAtivo && (
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
          <ProgressoJob
            status={job.status}
            progress={job.progress}
            message={job.message}
            processedCount={job.processedCount}
            totalProcesses={job.totalProcesses}
            onCancelar={jobAtivo ? handleCancelar : undefined}
            onDownload={job.status === 'completed' && job.fileName ? () => downloadPlanilhaDigito(job.jobId) : undefined}
          />
          {job.status === 'completed' && job.resumo && <ResumoDistribuicao resumo={job.resumo} />}
        </div>
      )}

      {/* ───── Formulário ───── */}
      {!job && (
        <>
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
                  onClick={() => setModoDigito(m.valor)}
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
                Informe o nome do servidor e clique nos dígitos dele. Cada dígito pertence a um
                único servidor; dígitos em branco vão para a aba <strong>Não atribuídos</strong>.
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
                </div>
              ))}
              <button type="button" onClick={addServidor} className="btn btn-ghost w-full py-2.5 text-sm">
                <Plus size={15} /> Adicionar servidor
              </button>
            </div>
            {atribuicoesValidas.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {servidoresConhecidos.map((s) => {
                  const digitos = atribuicoesValidas.filter((a) => a.servidor === s).map((a) => a.digito);
                  return (
                    <span key={s} className="chip bg-emerald-50 text-emerald-700">
                      {s}: dígito(s) {digitos.join(', ')}
                    </span>
                  );
                })}
                {digitosSemServidor.length > 0 && (
                  <span className="chip bg-slate-100 text-slate-600">
                    Sem servidor: {digitosSemServidor.join(', ')}
                  </span>
                )}
              </div>
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

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">4</span>
              <span className="eyebrow">Formato de saída</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Formato de saída">
              <FormatoBtn
                ativo={formato === 'xlsx'}
                onClick={() => setFormato('xlsx')}
                icone={<FileSpreadsheet size={18} />}
                titulo="Arquivo único (.xlsx)"
                descricao="Aba Resumo + uma aba por servidor no mesmo arquivo."
              />
              <FormatoBtn
                ativo={formato === 'zip'}
                onClick={() => setFormato('zip')}
                icone={<FileArchive size={18} />}
                titulo="Um arquivo por servidor (.zip)"
                descricao="Resumo.xlsx + cada planilha nomeada com o servidor."
              />
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3">
              <input
                type="checkbox"
                checked={reduzida}
                onChange={(e) => setReduzida(e.target.checked)}
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
        visivel={jobAtivo}
        mensagem={job?.message ?? ''}
        progresso={job?.progress ?? 0}
        onVer={() => rolarAte(progressoRef.current)}
        onCancelar={jobAtivo && job?.status !== 'cancelling' ? handleCancelar : undefined}
      />
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

function ResumoDistribuicao({ resumo }: { resumo: PlanilhaDigitoResumo }) {
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
              <p>• <strong>{resumo.semEtiquetaServidor}</strong> processo(s) sem a etiqueta do servidor responsável no PJE (flag SEM_ETIQUETA_DIGITO na planilha).</p>
            )}
            {resumo.etiquetaDivergente > 0 && (
              <p>• <strong>{resumo.etiquetaDivergente}</strong> processo(s) com etiqueta apontando para outro servidor (flag DIGITO_DIVERGENTE) — o cálculo pelo dígito prevalece.</p>
            )}
            {resumo.malformados > 0 && (
              <p>• <strong>{resumo.malformados}</strong> processo(s) com número fora do padrão CNJ.</p>
            )}
            <p className="pt-1 text-slate-600">
              A etiquetagem em lote pelo Fórum Hub está disponível no serviço &quot;Etiquetar Processos
              Parados&quot; (grupo &quot;Alterar no PJE&quot;), sempre com simulação antes de aplicar.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
