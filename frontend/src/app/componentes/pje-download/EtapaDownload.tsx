'use client';

import React, { useState, useMemo } from 'react';
import { Download, ClipboardList, Tag, Hash, ArrowLeft, AlertCircle } from 'lucide-react';
import type { PerfilPJE, TarefaPJE, EtiquetaPJE, ParametrosDownload, PJEDownloadMode } from './types';
import { ListaTarefas } from './ListaTarefas';
import { ListaEtiquetas } from './ListaEtiquetas';

interface EtapaDownloadProps {
  perfil: PerfilPJE;
  tarefas: TarefaPJE[];
  tarefasFavoritas: TarefaPJE[];
  etiquetas: EtiquetaPJE[];
  carregando: boolean;
  erro: string | null;
  onCriarJob: (params: ParametrosDownload) => void;
  onVoltar: () => void;
}

const MODOS: Array<{ id: PJEDownloadMode; icone: React.ReactNode; rotulo: string; desc: string }> = [
  { id: 'by_task',   icone: <ClipboardList size={16} />, rotulo: 'Por Tarefa',   desc: 'Baixar processos de uma tarefa' },
  { id: 'by_tag',    icone: <Tag size={16} />,           rotulo: 'Por Etiqueta', desc: 'Baixar por etiqueta/marcador' },
];

export function EtapaDownload({
  perfil, tarefas, tarefasFavoritas, etiquetas,
  carregando, erro, onCriarJob, onVoltar,
}: EtapaDownloadProps) {
  const [modo, setModo] = useState<PJEDownloadMode>('by_task');
  const [tarefaSelecionada, setTarefaSelecionada] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [etiquetaSelecionada, setEtiquetaSelecionada] = useState<number | null>(null);
  const [numerosProcesso, setNumerosProcesso] = useState('');

  const totalProcessosTarefa = useMemo(() => {
    const lista = isFavorite ? tarefasFavoritas : tarefas;
    return lista.find((t) => t.nome === tarefaSelecionada)?.quantidadePendente || 0;
  }, [tarefas, tarefasFavoritas, tarefaSelecionada, isFavorite]);

  const numerosParseados = numerosProcesso.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);

  const podeSubmit = (): boolean => {
    if (carregando) return false;
    if (modo === 'by_task') return !!tarefaSelecionada;
    if (modo === 'by_tag') return !!etiquetaSelecionada;
    return numerosParseados.length > 0;
  };

  const handleSubmit = () => {
    if (modo === 'by_task' && tarefaSelecionada) {
      onCriarJob({ mode: 'by_task', taskName: tarefaSelecionada, isFavorite });
    } else if (modo === 'by_tag' && etiquetaSelecionada) {
      const etq = etiquetas.find((e) => e.id === etiquetaSelecionada);
      onCriarJob({ mode: 'by_tag', tagId: etiquetaSelecionada, tagName: etq?.nomeTag });
    }
  };

  const botaoLabel = (): string => {
    if (modo === 'by_task' && tarefaSelecionada) return `Baixar ${totalProcessosTarefa} processo(s) de "${tarefaSelecionada}"`;
    if (modo === 'by_tag' && etiquetaSelecionada) return 'Baixar processos da etiqueta';
    return 'Selecione uma opção acima';
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <button type="button" onClick={onVoltar} className="text-slate-400 hover:text-slate-700"><ArrowLeft size={16} /></button>
        <h3 className="text-lg font-bold text-slate-900">Novo Download</h3>
      </div>
      <p className="text-xs text-slate-500 mb-6 ml-6">Perfil: <span className="font-semibold text-slate-700">{perfil.nome}</span></p>

      {erro && (
        <div className="mb-4 p-3 bg-red-50 border-2 border-red-200 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{erro}</p>
        </div>
      )}

      {/* Seleção de modo */}
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
              <p className="text-xs text-slate-500 mt-1">
                {totalProcessosTarefa} processo(s) pendente(s)
                {totalProcessosTarefa > 500 && <span className="ml-1 text-amber-600 font-semibold">— download será paginado</span>}
              </p>
            </div>
          )}
        </>
      )}

      {modo === 'by_tag' && (
        <ListaEtiquetas etiquetas={etiquetas} selecionada={etiquetaSelecionada} onSelecionar={setEtiquetaSelecionada} />
      )}

      <div className="mt-6">
        <button type="button" onClick={handleSubmit} disabled={!podeSubmit()}
          className={`w-full flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold transition-all ${
            podeSubmit() ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}>
          {carregando
            ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processando...</>
            : <><Download size={16} /> {botaoLabel()}</>}
        </button>
      </div>
    </div>
  );
}
