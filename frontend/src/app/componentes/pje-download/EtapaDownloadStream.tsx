'use client';

import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  Download, ClipboardList, Tag, Hash, ArrowLeft, AlertCircle,
  FolderOpen, Loader2, CheckCircle, X, HardDrive, FileArchive,
} from 'lucide-react';
import type { PerfilPJE, TarefaPJE, EtiquetaPJE, PJEDownloadMode } from './types';
import { ListaTarefas } from './ListaTarefas';
import { ListaEtiquetas } from './ListaEtiquetas';
import { FileSystemManager } from '../../lib/filesystem-manager';
import { DownloadManager, type DownloadProgress, type DownloadManagerParams } from '../../lib/download-manager';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface EtapaDownloadStreamProps {
  perfil: PerfilPJE;
  tarefas: TarefaPJE[];
  tarefasFavoritas: TarefaPJE[];
  etiquetas: EtiquetaPJE[];
  sessionId: string;
  onVoltar: () => void;
}

const MODOS: Array<{ id: PJEDownloadMode; icone: React.ReactNode; rotulo: string; desc: string }> = [
  { id: 'by_task',   icone: <ClipboardList size={16} />, rotulo: 'Por Tarefa',   desc: 'Baixar processos de uma tarefa' },
  { id: 'by_tag',    icone: <Tag size={16} />,           rotulo: 'Por Etiqueta', desc: 'Baixar por etiqueta/marcador' },
  { id: 'by_number', icone: <Hash size={16} />,          rotulo: 'Por Número',   desc: 'Informar números CNJ' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EtapaDownloadStream({
  perfil, tarefas, tarefasFavoritas, etiquetas,
  sessionId, onVoltar,
}: EtapaDownloadStreamProps) {
  const [modo, setModo] = useState<PJEDownloadMode>('by_task');
  const [tarefaSelecionada, setTarefaSelecionada] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [etiquetaSelecionada, setEtiquetaSelecionada] = useState<number | null>(null);
  const [numerosProcesso, setNumerosProcesso] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const managerRef = useRef<DownloadManager | null>(null);

  const isActive = progress && !['done', 'error', 'cancelled'].includes(progress.phase);
  const fsApiSupported = FileSystemManager.isSupported();

  const totalProcessosTarefa = useMemo(() => {
    const lista = isFavorite ? tarefasFavoritas : tarefas;
    return lista.find((t) => t.nome === tarefaSelecionada)?.quantidadePendente || 0;
  }, [tarefas, tarefasFavoritas, tarefaSelecionada, isFavorite]);

  const numerosParseados = numerosProcesso.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);

  const podeSubmit = (): boolean => {
    if (isActive) return false;
    if (modo === 'by_task') return !!tarefaSelecionada;
    if (modo === 'by_tag') return !!etiquetaSelecionada;
    return numerosParseados.length > 0;
  };

  const handleSubmit = useCallback(async () => {
    setErro(null);
    setProgress(null);

    const manager = new DownloadManager();
    managerRef.current = manager;

    const params: DownloadManagerParams = {
      apiBase: API_BASE,
      sessionId,
      mode: modo,
    };

    if (modo === 'by_task') {
      params.taskName = tarefaSelecionada;
      params.isFavorite = isFavorite;
    } else if (modo === 'by_tag') {
      params.tagId = etiquetaSelecionada!;
      const etq = etiquetas.find((e) => e.id === etiquetaSelecionada);
      params.tagName = etq?.nomeTag;
    } else {
      params.processNumbers = numerosParseados;
    }

    try {
      await manager.execute(params, (p) => setProgress({ ...p }));
    } catch (err: any) {
      setErro(err.message || 'Erro inesperado');
    }
  }, [modo, tarefaSelecionada, isFavorite, etiquetaSelecionada, etiquetas, numerosParseados, sessionId]);

  const handleCancelar = useCallback(() => {
    managerRef.current?.cancel();
  }, []);

  const pct = progress
    ? progress.totalProcesses > 0
      ? Math.round(((progress.successCount + progress.failedCount) / progress.totalProcesses) * 100)
      : 0
    : 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <button type="button" onClick={onVoltar} disabled={!!isActive} className="text-slate-400 hover:text-slate-700 disabled:opacity-30">
          <ArrowLeft size={16} />
        </button>
        <h3 className="text-lg font-bold text-slate-900">Download de Processos</h3>
      </div>
      <p className="text-xs text-slate-500 mb-6 ml-6">
        Perfil: <span className="font-semibold text-slate-700">{perfil.nome}</span>
      </p>

      <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-200 flex items-start gap-3">
        <FolderOpen size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800">
          <p className="font-bold mb-1">
            {fsApiSupported ? 'Salve direto no seu computador' : 'Download como ZIP'}
          </p>
          <p>
            {fsApiSupported
              ? 'Ao iniciar, você escolherá uma pasta do seu PC. Os PDFs serão salvos automaticamente lá, sem passar pelo servidor.'
              : 'Seu navegador não suporta seleção de pasta. Os PDFs serão empacotados em um arquivo ZIP para download.'}
          </p>
          <p className="mt-1 text-xs text-blue-600 flex items-center gap-1">
            {fsApiSupported
              ? <><HardDrive size={12} /> File System Access API (Chrome/Edge)</>
              : <><FileArchive size={12} /> Modo ZIP (Firefox/Safari)</>}
          </p>
        </div>
      </div>

      {erro && (
        <div className="mb-4 p-3 bg-red-50 border-2 border-red-200 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{erro}</p>
        </div>
      )}

      {progress && (
        <div className={`mb-6 p-4 border-2 ${
          progress.phase === 'done' ? 'border-emerald-300 bg-emerald-50' :
          progress.phase === 'error' || progress.phase === 'cancelled' ? 'border-red-300 bg-red-50' :
          'border-blue-300 bg-blue-50'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {progress.phase === 'done' ? <CheckCircle size={16} className="text-emerald-600" /> :
               progress.phase === 'error' || progress.phase === 'cancelled' ? <AlertCircle size={16} className="text-red-600" /> :
               <Loader2 size={16} className="text-blue-600 animate-spin" />}
              <span className="text-sm font-bold text-slate-900">{progress.message}</span>
            </div>
            {isActive && (
              <button type="button" onClick={handleCancelar} className="text-xs font-bold text-red-600 hover:text-red-800 flex items-center gap-1">
                <X size={14} /> Cancelar
              </button>
            )}
          </div>

          {isActive && progress.totalProcesses > 0 && (
            <>
              <div className="w-full h-2 bg-slate-200 overflow-hidden mb-1">
                <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{progress.successCount + progress.failedCount}/{progress.totalProcesses} processos</span>
                <span>{formatBytes(progress.bytesDownloaded)}</span>
              </div>
            </>
          )}

          {progress.phase === 'done' && (
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="p-2 bg-emerald-100 text-center">
                <div className="text-lg font-bold text-emerald-800">{progress.successCount}</div>
                <div className="text-[10px] text-emerald-600">Baixados</div>
              </div>
              <div className="p-2 bg-red-100 text-center">
                <div className="text-lg font-bold text-red-800">{progress.failedCount}</div>
                <div className="text-[10px] text-red-600">Falhas</div>
              </div>
              <div className="p-2 bg-slate-100 text-center">
                <div className="text-lg font-bold text-slate-800">{formatBytes(progress.bytesDownloaded)}</div>
                <div className="text-[10px] text-slate-600">Total</div>
              </div>
            </div>
          )}

          {progress.files.length > 0 && (
            <div className="mt-3 max-h-32 overflow-y-auto">
              {progress.files.slice(-8).reverse().map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 py-0.5 text-xs">
                  {f.status === 'ok' && <CheckCircle size={10} className="text-emerald-500" />}
                  {f.status === 'downloading' && <Loader2 size={10} className="text-blue-500 animate-spin" />}
                  {f.status === 'error' && <X size={10} className="text-red-500" />}
                  <span className={`truncate ${f.status === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
                    {f.name}
                  </span>
                  {f.size > 0 && <span className="text-slate-400 flex-shrink-0">{formatBytes(f.size)}</span>}
                  {f.error && <span className="text-red-400 truncate">{f.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isActive && (
        <>
          <div className="mb-6">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">Modo de Download</label>
            <div className="grid grid-cols-3 gap-2">
              {MODOS.map((m) => (
                <button key={m.id} type="button" onClick={() => setModo(m.id)}
                  className={`p-3 border-2 text-left transition-all ${modo === m.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={modo === m.id ? 'text-slate-900' : 'text-slate-400'}>{m.icone}</span>
                    <span className={`text-sm font-bold ${modo === m.id ? 'text-slate-900' : 'text-slate-600'}`}>{m.rotulo}</span>
                  </div>
                  <p className="text-xs text-slate-400">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {modo === 'by_task' && (
            <>
              <ListaTarefas
                tarefas={tarefas} tarefasFavoritas={tarefasFavoritas}
                tarefaSelecionada={tarefaSelecionada} isFavorite={isFavorite}
                onSelecionar={(nome, fav) => { setTarefaSelecionada(nome); setIsFavorite(fav); }}
              />
              {tarefaSelecionada && (
                <div className="mt-4 p-3 bg-slate-50 border-2 border-slate-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-500 uppercase">Tarefa selecionada</span>
                    <span className={`text-xs px-2 py-0.5 font-bold ${isFavorite ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isFavorite ? '⭐ Minhas Tarefas' : '📋 Todas as Tarefas'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{tarefaSelecionada}</p>
                  <p className="text-xs text-slate-500 mt-1">{totalProcessosTarefa} processo(s) pendente(s)</p>
                </div>
              )}
            </>
          )}

          {modo === 'by_tag' && (
            <ListaEtiquetas etiquetas={etiquetas} selecionada={etiquetaSelecionada} onSelecionar={setEtiquetaSelecionada} />
          )}

          {modo === 'by_number' && (
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">Números de Processo (CNJ)</label>
              <textarea value={numerosProcesso} onChange={(e) => setNumerosProcesso(e.target.value)}
                placeholder={'Cole os números aqui, um por linha.\nFormato: NNNNNNN-DD.AAAA.J.TT.OOOO'}
                rows={8} className="w-full p-3 border-2 border-slate-200 text-sm font-mono focus:border-slate-400 focus:outline-none resize-none" />
              <div className="flex justify-between mt-2">
                <p className="text-xs text-slate-400">Separe por linha, vírgula ou ponto e vírgula.</p>
                <p className="text-xs text-slate-500 font-bold">{numerosParseados.length} processo(s)</p>
              </div>
            </div>
          )}

          <div className="mt-6">
            <button type="button" onClick={handleSubmit} disabled={!podeSubmit()}
              className={`w-full flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold transition-all ${
                podeSubmit() ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}>
              <Download size={16} />
              {fsApiSupported ? 'Escolher pasta e baixar' : 'Baixar como ZIP'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
