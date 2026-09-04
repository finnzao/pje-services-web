'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet, FileArchive, Hash, Info, Loader2, Tags, AlertTriangle,
} from 'lucide-react';
import { ListaTarefas, type TarefaSelecionada } from './ListaTarefas';
import { ProgressoJob } from './ProgressoJob';
import type { TarefaPJE } from './types';
import {
  gerarPlanilhaDigito, obterProgressoDigito, cancelarPlanilhaDigito, downloadPlanilhaDigito,
  type PlanilhaDigitoProgress, type PlanilhaDigitoResumo,
} from './api-planilha-digito';

const DIGITOS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const POLL_INTERVAL_MS = 2500;

interface TelaPlanilhaDigitoProps {
  sessionId: string;
  tarefas: TarefaPJE[];
  credenciais: { cpf: string; password: string } | null;
  perfilIndice?: number;
}

export function TelaPlanilhaDigito({ sessionId, tarefas, credenciais, perfilIndice }: TelaPlanilhaDigitoProps) {
  const [atribuicoes, setAtribuicoes] = useState<Record<number, string>>({});
  const [ignoradas, setIgnoradas] = useState<TarefaSelecionada[]>([]);
  const [formato, setFormato] = useState<'xlsx' | 'zip'>('xlsx');
  const [erro, setErro] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [job, setJob] = useState<PlanilhaDigitoProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const servidoresConhecidos = useMemo(
    () => [...new Set(Object.values(atribuicoes).map((s) => s.trim()).filter(Boolean))],
    [atribuicoes],
  );

  const atribuicoesValidas = useMemo(
    () => DIGITOS
      .filter((d) => (atribuicoes[d] || '').trim())
      .map((d) => ({ digito: d, servidor: atribuicoes[d].trim() })),
    [atribuicoes],
  );

  const digitosSemServidor = DIGITOS.filter((d) => !(atribuicoes[d] || '').trim());

  const setServidor = useCallback((digito: number, nome: string) => {
    setAtribuicoes((prev) => ({ ...prev, [digito]: nome }));
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
        if (['completed', 'failed', 'cancelled'].includes(p.status)) stopPolling();
      } catch { /* falha transitória de rede: a próxima rodada tenta de novo */ }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  const handleGerar = useCallback(async () => {
    setErro(null);
    setIniciando(true);
    setJob(null);
    try {
      const result = await gerarPlanilhaDigito({
        credentials: credenciais ?? undefined,
        pjeSessionId: sessionId,
        pjeProfileIndex: perfilIndice,
        atribuicoes: atribuicoesValidas,
        tarefasIgnoradas: ignoradas.map((t) => t.nome),
        formato,
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
  }, [credenciais, sessionId, perfilIndice, atribuicoesValidas, ignoradas, formato, startPolling]);

  const handleCancelar = useCallback(async () => {
    if (!job) return;
    setJob((p) => p ? { ...p, status: 'cancelling', message: 'Cancelando...' } : null);
    try { await cancelarPlanilhaDigito(job.jobId); } catch { /* progresso reflete o estado real */ }
  }, [job]);

  const jobAtivo = job && !['completed', 'failed', 'cancelled'].includes(job.status);

  return (
    <div className="space-y-8">
      {erro && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
          <span>{erro}</span>
        </div>
      )}

      {job && (
        <div>
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

      {!jobAtivo && (
        <>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">2</span>
              <span className="eyebrow">Atribua os dígitos aos servidores</span>
            </div>
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-navy-50 px-3.5 py-2.5 text-xs text-navy-700">
              <Info size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                O dígito é o <strong>último algarismo do sequencial</strong> do número CNJ
                (ex.: 800173<strong>2</strong>-90.2023… → dígito 2). Um servidor pode acumular
                vários dígitos; dígitos em branco vão para a aba <strong>Não atribuídos</strong>.
              </span>
            </div>
            <datalist id="servidores-digito">
              {servidoresConhecidos.map((s) => <option key={s} value={s} />)}
            </datalist>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DIGITOS.map((d) => (
                <label key={d} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 focus-within:border-navy-400">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-navy-50 text-sm font-bold text-navy-700">
                    {d}
                  </span>
                  <input
                    type="text"
                    list="servidores-digito"
                    value={atribuicoes[d] || ''}
                    onChange={(e) => setServidor(d, e.target.value)}
                    placeholder="Sem servidor (não atribuído)"
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-300"
                  />
                </label>
              ))}
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
                  <span className="chip bg-slate-100 text-slate-500">
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
              <Info size={14} className="mt-0.5 flex-shrink-0" />
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
              <p className="mt-2 text-xs text-slate-500">
                {ignoradas.length} tarefa(s) ignorada(s): {ignoradas.map((t) => t.nome).join(' · ')}
              </p>
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="num-badge">4</span>
              <span className="eyebrow">Formato de saída</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormatoBtn
                ativo={formato === 'xlsx'}
                onClick={() => setFormato('xlsx')}
                icone={<FileSpreadsheet size={18} />}
                titulo="Arquivo único (.xlsx)"
                descricao="Uma aba por servidor no mesmo arquivo."
              />
              <FormatoBtn
                ativo={formato === 'zip'}
                onClick={() => setFormato('zip')}
                icone={<FileArchive size={18} />}
                titulo="Um arquivo por servidor (.zip)"
                descricao="Cada planilha nomeada com o nome do servidor."
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleGerar}
            disabled={iniciando || atribuicoesValidas.length === 0}
            className="btn btn-emerald w-full py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {iniciando
              ? <><Loader2 size={16} className="animate-spin" /> Iniciando…</>
              : <><Hash size={16} /> Gerar planilha por dígito</>}
          </button>
          {atribuicoesValidas.length === 0 && (
            <p className="-mt-4 text-center text-xs text-slate-400">
              Atribua ao menos um dígito a um servidor para gerar.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FormatoBtn({ ativo, onClick, icone, titulo, descricao }: {
  ativo: boolean; onClick: () => void; icone: React.ReactNode; titulo: string; descricao: string;
}) {
  return (
    <button type="button" onClick={onClick} className={`pick p-4 text-left ${ativo ? 'pick-on' : ''}`}>
      <span className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg ${ativo ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
        {icone}
      </span>
      <h4 className="text-sm font-semibold text-ink">{titulo}</h4>
      <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>
    </button>
  );
}

function ResumoDistribuicao({ resumo }: { resumo: PlanilhaDigitoResumo }) {
  const pendencias = resumo.naoAtribuidos.total > 0 || resumo.semEtiquetaServidor > 0 || resumo.etiquetaDivergente > 0;
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Distribuição</p>
        <div className="flex flex-wrap gap-1.5">
          {resumo.porServidor.map((s) => (
            <span key={s.servidor} className="chip bg-navy-50 text-navy-700">
              {s.servidor} (dígitos {s.digitos.join(', ')}): <strong>{s.total}</strong>
            </span>
          ))}
          {resumo.naoAtribuidos.total > 0 && (
            <span className="chip bg-brass-50 text-brass-600">
              Não atribuídos: <strong>{resumo.naoAtribuidos.total}</strong>
            </span>
          )}
        </div>
      </div>

      {pendencias && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-brass-200 bg-brass-50/60 p-4 text-sm text-slate-700">
          <Tags size={16} className="mt-0.5 flex-shrink-0 text-brass-500" />
          <div className="space-y-1.5 text-xs leading-relaxed">
            <p className="font-semibold text-ink">Pendências de etiquetagem encontradas</p>
            {resumo.naoAtribuidos.digitosSemServidor.length > 0 && (
              <p>• Dígito(s) <strong>{resumo.naoAtribuidos.digitosSemServidor.join(', ')}</strong> sem servidor atribuído — os processos estão na aba/arquivo &quot;Não atribuídos&quot;.</p>
            )}
            {resumo.semEtiquetaServidor > 0 && (
              <p>• <strong>{resumo.semEtiquetaServidor}</strong> processo(s) sem a etiqueta do servidor responsável no PJE (flag SEM_ETIQUETA_SERVIDOR na planilha).</p>
            )}
            {resumo.etiquetaDivergente > 0 && (
              <p>• <strong>{resumo.etiquetaDivergente}</strong> processo(s) com etiqueta apontando para outro servidor (flag ETIQUETA_DIVERGENTE) — o cálculo pelo dígito prevalece.</p>
            )}
            {resumo.malformados > 0 && (
              <p>• <strong>{resumo.malformados}</strong> processo(s) com número fora do padrão CNJ.</p>
            )}
            <p className="pt-1 text-slate-500">
              A etiquetagem em lote direto pelo Fórum Hub (aplicar a etiqueta do servidor nesses
              processos) será habilitada na próxima etapa desta funcionalidade.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
