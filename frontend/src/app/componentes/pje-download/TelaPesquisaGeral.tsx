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
type StatusFila = 'pendente' | 'executando' | 'concluido' | 'erro' | 'cancelado';
interface ItemFila { nome: string; status: StatusFila; resumo?: string; }

interface TelaPesquisaGeralProps {
  perfil: PerfilPJE;
  sessionId: string;
}

function contarPalavrasFila(valor: string): number {
  return valor.trim().split(/\s+/).filter(Boolean).length;
}

const ROTULOS_FILTRO_FIXO: Partial<Record<keyof SearchCriteria, string>> = {
  numeroSequencial: 'Sequencial', numeroDigito: 'Dígito', numeroAno: 'Ano',
  numeroTribunal: 'Tribunal', numeroOrgao: 'Comarca',
  jurisdicao: 'Jurisdição', orgaoJulgador: 'Órgão Julgador',
  classeJudicial: 'Classe', assunto: 'Assunto',
  outrosNomes: 'Outros nomes', nomeAdvogado: 'Advogado',
  documentoParte: 'Documento da parte', numeroDocumento: 'Nº documento',
  numeroOAB: 'OAB nº', letraOAB: 'OAB letra', ufOAB: 'OAB UF',
  dataAutuacaoInicio: 'Autuação de', dataAutuacaoFim: 'Autuação até',
  valorCausaInicial: 'Valor da causa de', valorCausaFinal: 'Valor da causa até',
};

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

  const [modoFila, setModoFila] = useState(false);
  const [nomesFila, setNomesFila] = useState('');
  const [filaItens, setFilaItens] = useState<ItemFila[]>([]);
  const [filaExecutando, setFilaExecutando] = useState(false);
  const filaCancelRef = useRef(false);

  const downloadRef = useRef<DownloadManager | null>(null);
  const planilhaRef = useRef<PlanilhaPesquisaManager | null>(null);

  const listaNomes = useMemo(
    () => nomesFila.split('\n').map((s) => s.trim()).filter(Boolean),
    [nomesFila],
  );
  const nomesInvalidos = useMemo(
    () => listaNomes.filter((n) => contarPalavrasFila(n) < 2),
    [listaNomes],
  );

  const filtrosFixos = useMemo(() => {
    return (Object.keys(ROTULOS_FILTRO_FIXO) as Array<keyof SearchCriteria>)
      .filter((campo) => (criteria[campo] || '').toString().trim())
      .map((campo) => `${ROTULOS_FILTRO_FIXO[campo]}: ${criteria[campo]}`);
  }, [criteria]);

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
  const ocupado = !!(downloadAtivo || planilhaAtiva || filaExecutando);

  const bloqueado = useMemo(() => {
    if (modoFila) {
      if (listaNomes.length === 0) return 'Cole ao menos um nome (um por linha).';
      if (nomesInvalidos.length > 0) return `${nomesInvalidos.length} nome(s) com menos de duas palavras.`;
      return null;
    }
    if (nomePartePendente(criteria)) return 'A pesquisa por Nome da Parte deve conter pelo menos duas palavras.';
    if (nomeAdvogadoPendente(criteria)) return 'A pesquisa por Nome do Representante deve conter pelo menos duas palavras.';
    if (!temAlgumCriterio(criteria)) return 'Informe ao menos um critério de pesquisa.';
    return null;
  }, [criteria, modoFila, listaNomes, nomesInvalidos]);

  const podeSubmit = !bloqueado && !ocupado;

  interface ResultadoBusca { ok: boolean; resumo: string; totalProcessos: number; sucesso: number; falhas: number; }

  const executarBusca = useCallback(async (
    criteriaAlvo: SearchCriteria, tipo: Acao, opts?: { fsCompartilhado?: FileSystemManager; skipReport?: boolean },
  ): Promise<ResultadoBusca> => {
    if (tipo === 'download') {
      const manager = new DownloadManager(opts?.fsCompartilhado);
      downloadRef.current = manager;
      let last: DownloadProgress | null = null;
      const params: DownloadManagerParams = {
        apiBase: API_BASE,
        sessionId,
        mode: 'by_search',
        searchCriteria: criteriaAlvo,
        label: criteriaAlvo.nomeParte,
        skipReport: opts?.skipReport,
      };
      try {
        await manager.execute(params, (p) => { last = p; setDownloadProgress({ ...p }); });
        const final = last as DownloadProgress | null;
        const totalProcessos = final?.totalProcesses ?? 0;
        const sucesso = final?.successCount ?? 0;
        const falhas = final?.failedCount ?? 0;
        return {
          ok: !!final && final.phase === 'done',
          resumo: `${sucesso}/${final?.totalRequests || totalProcessos} arquivo(s)`,
          totalProcessos, sucesso, falhas,
        };
      } catch (err: any) {
        setErro(err?.message || 'Erro inesperado');
        return { ok: false, resumo: err?.message || 'Erro', totalProcessos: 0, sucesso: 0, falhas: 0 };
      }
    }
    const manager = new PlanilhaPesquisaManager();
    planilhaRef.current = manager;
    let last: PesquisaProgress | null = null;
    try {
      await manager.execute(
        { apiBase: API_BASE, sessionId, criteria: criteriaAlvo, label: criteriaAlvo.nomeParte },
        (p) => { last = p; setPlanilhaProgress({ ...p }); },
      );
      const final = last as PesquisaProgress | null;
      const totalProcessos = final?.collected ?? 0;
      return {
        ok: !!final && final.phase === 'done',
        resumo: `${totalProcessos} processo(s)`,
        totalProcessos, sucesso: totalProcessos, falhas: 0,
      };
    } catch (err: any) {
      setErro(err?.message || 'Erro inesperado');
      return { ok: false, resumo: err?.message || 'Erro', totalProcessos: 0, sucesso: 0, falhas: 0 };
    }
  }, [sessionId]);

  const salvarRelatorioFinal = useCallback(async (
    resultados: Array<{ nome: string; totalProcessos: number; sucesso: number; falhas: number; cancelado: boolean }>,
    fsCompartilhado?: FileSystemManager,
  ) => {
    if (resultados.length === 0) return;
    const agora = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const dataHora = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())}_${p2(agora.getHours())}h${p2(agora.getMinutes())}`;

    const comProcessos = resultados.filter((r) => !r.cancelado && r.totalProcessos > 0);
    const semProcessos = resultados.filter((r) => !r.cancelado && r.totalProcessos === 0);
    const cancelados = resultados.filter((r) => r.cancelado);

    const linhas: string[] = [
      '═══════════════════════════════════════════════════',
      '  RELATÓRIO — PESQUISA MÚLTIPLA (PJE/TJBA)',
      '═══════════════════════════════════════════════════',
      '',
      `Data: ${agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      `Ação: ${acao === 'download' ? 'Baixar processos' : 'Gerar planilha'}`,
      `Filtros fixos: ${filtrosFixos.join('; ') || '(nenhum)'}`,
      `Total de nomes pesquisados: ${resultados.length}`,
      '',
      `PARTES COM PROCESSOS ENCONTRADOS (${comProcessos.length}):`,
      ...comProcessos.map((r) => `  - ${r.nome}: ${r.totalProcessos} processo(s)${acao === 'download' ? ` (${r.sucesso} arquivo(s) baixado(s)${r.falhas > 0 ? `, ${r.falhas} falha(s)` : ''})` : ''}`),
      '',
      `PARTES SEM PROCESSO ENCONTRADO (${semProcessos.length}):`,
      ...semProcessos.map((r) => `  - ${r.nome}`),
    ];

    if (cancelados.length > 0) {
      linhas.push('', `NÃO EXECUTADOS — fila cancelada (${cancelados.length}):`, ...cancelados.map((r) => `  - ${r.nome}`));
    }
    linhas.push('', '═══════════════════════════════════════════════════');

    const blob = new Blob([linhas.join('\n')], { type: 'text/plain; charset=utf-8' });
    const fileName = `_RELATORIO_PESQUISA_MULTIPLA_${dataHora}.txt`;

    if (fsCompartilhado) {
      await fsCompartilhado.saveRootFile(fileName, blob);
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = fileName; anchor.rel = 'noopener';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, [acao, filtrosFixos]);

  const handleDownload = useCallback(async () => {
    setErro(null);
    setDownloadProgress(null);
    await executarBusca(criteria, 'download');
  }, [criteria, executarBusca]);

  const handlePlanilha = useCallback(async () => {
    setErro(null);
    setPlanilhaProgress(null);
    await executarBusca(criteria, 'planilha');
  }, [criteria, executarBusca]);

  const handleFila = useCallback(async () => {
    setErro(null);
    filaCancelRef.current = false;
    setFilaItens(listaNomes.map((nome) => ({ nome, status: 'pendente' as StatusFila })));
    setFilaExecutando(true);

    // Uma única pasta/instância compartilhada para toda a fila — evita repetir o
    // seletor de pasta do navegador a cada pessoa (o Chrome/Edge só pergunta uma vez).
    const fsCompartilhado = acao === 'download' ? new FileSystemManager() : undefined;
    const resultados: Array<{ nome: string; totalProcessos: number; sucesso: number; falhas: number; cancelado: boolean }> = [];

    for (let i = 0; i < listaNomes.length; i++) {
      if (filaCancelRef.current) {
        setFilaItens((prev) => prev.map((it, idx) => (idx >= i ? { ...it, status: 'cancelado' as StatusFila } : it)));
        resultados.push(...listaNomes.slice(i).map((nome) => ({ nome, totalProcessos: 0, sucesso: 0, falhas: 0, cancelado: true })));
        break;
      }
      setFilaItens((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'executando' as StatusFila } : it)));
      setDownloadProgress(null);
      setPlanilhaProgress(null);
      const criteriaAlvo: SearchCriteria = { ...criteria, nomeParte: listaNomes[i] };
      const { ok, resumo, totalProcessos, sucesso, falhas } = await executarBusca(
        criteriaAlvo, acao, { fsCompartilhado, skipReport: true },
      );
      resultados.push({ nome: listaNomes[i], totalProcessos, sucesso, falhas, cancelado: false });
      setFilaItens((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: ok ? 'concluido' as StatusFila : 'erro' as StatusFila, resumo } : it)));
    }

    await salvarRelatorioFinal(resultados, fsCompartilhado);
    fsCompartilhado?.dispose();
    setFilaExecutando(false);
  }, [listaNomes, criteria, acao, executarBusca, salvarRelatorioFinal]);

  const handleSubmit = useCallback(() => {
    if (!podeSubmit) return;
    if (modoFila) { handleFila(); return; }
    if (acao === 'download') handleDownload();
    else handlePlanilha();
  }, [podeSubmit, modoFila, acao, handleFila, handleDownload, handlePlanilha]);

  const handleCancelar = useCallback(() => {
    filaCancelRef.current = true;
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
        <label className="mb-4 flex items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={modoFila}
            disabled={ocupado}
            onChange={(e) => setModoFila(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Pesquisa Múltipla: mesmos critérios, vários nomes de parte
        </label>

        {modoFila && (
          <div className="mb-4">
            <label className="label mb-1.5">Lista de nomes das partes ({listaNomes.length})</label>
            <textarea
              value={nomesFila}
              onChange={(e) => setNomesFila(e.target.value)}
              disabled={ocupado}
              rows={6}
              placeholder={'Cole um nome por linha, ex:\nJoão da Silva\nMaria Souza Santos'}
              className="field font-mono text-xs"
            />
            {nomesInvalidos.length > 0 && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle size={12} /> Precisam de pelo menos duas palavras: {nomesInvalidos.slice(0, 3).join(', ')}{nomesInvalidos.length > 3 ? '…' : ''}
              </p>
            )}
            <div className="mt-2 flex items-start gap-2 rounded-xl bg-navy-50 px-3.5 py-2.5 text-xs text-navy-700">
              <Search size={13} className="mt-0.5 shrink-0" />
              <span>
                {filtrosFixos.length > 0
                  ? <>Fixo para todos os nomes: {filtrosFixos.join(' · ')}</>
                  : 'Nenhum outro critério fixado — preencha os campos abaixo (ex: comarca, tribunal) para aplicá-los a todos os nomes da lista.'}
              </span>
            </div>
            {acao === 'download' && (
              <p className="mt-2 text-xs text-slate-400">
                Se o navegador suportar acesso a pastas (Chrome/Edge), cada parte com processo encontrado gera sua própria subpasta com os PDFs soltos (sem ZIP); partes sem processo não geram pasta. Ao final, um relatório único com o resumo de todas as partes é salvo na mesma pasta.
              </p>
            )}
          </div>
        )}

        <FormularioPesquisa
          criteria={criteria}
          onChange={setCriteria}
          opcoes={opcoes}
          carregandoOpcoes={carregandoOpcoes}
          desabilitado={ocupado}
          ocultarNomeParte={modoFila}
        />
      </div>

      {erro && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
          <span>{erro}</span>
        </div>
      )}

      {modoFila && filaItens.length > 0 && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-ink">
              Pesquisa múltipla: {filaItens.filter((it) => it.status !== 'pendente' && it.status !== 'executando').length}/{filaItens.length} concluído(s)
            </span>
            {filaExecutando && (
              <button type="button" onClick={handleCancelar} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800">
                <X size={14} /> Cancelar
              </button>
            )}
          </div>
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {filaItens.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  {item.status === 'concluido' && <CheckCircle size={14} className="shrink-0 text-emerald-600" />}
                  {item.status === 'erro' && <AlertCircle size={14} className="shrink-0 text-red-600" />}
                  {item.status === 'cancelado' && <X size={14} className="shrink-0 text-slate-400" />}
                  {item.status === 'executando' && <Loader2 size={14} className="shrink-0 animate-spin text-navy-600" />}
                  {item.status === 'pendente' && <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300" />}
                  <span className="truncate text-ink">{item.nome}</span>
                </div>
                <span className="shrink-0 text-xs text-slate-500">{item.resumo}</span>
              </div>
            ))}
          </div>
          {filaExecutando && (
            <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              {(acao === 'download' ? downloadProgress?.message : planilhaProgress?.message) || 'Iniciando...'}
            </div>
          )}
        </div>
      )}

      {!modoFila && acao === 'download' && downloadProgress && (
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

      {!modoFila && acao === 'planilha' && planilhaProgress && (
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
        {ocupado
          ? 'Processando…'
          : modoFila
            ? `Executar pesquisa múltipla (${listaNomes.length})`
            : acao === 'planilha' ? 'Gerar planilha' : 'Baixar processos'}
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
