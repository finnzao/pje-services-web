'use client';

import React, { useMemo } from 'react';
import { Search, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { SearchCriteria, SearchFormOptions } from './types';

interface FormularioPesquisaProps {
  criteria: SearchCriteria;
  onChange: (criteria: SearchCriteria) => void;
  opcoes: SearchFormOptions;
  carregandoOpcoes?: boolean;
  desabilitado?: boolean;
}

function contarPalavras(valor?: string): number {
  return (valor || '').trim().split(/\s+/).filter(Boolean).length;
}

export function nomePartePendente(criteria: SearchCriteria): boolean {
  const n = contarPalavras(criteria.nomeParte);
  return n === 1;
}

export function nomeAdvogadoPendente(criteria: SearchCriteria): boolean {
  const n = contarPalavras(criteria.nomeAdvogado);
  return n === 1;
}

export function temAlgumCriterio(criteria: SearchCriteria): boolean {
  return Object.values(criteria).some((v) => (v || '').toString().trim().length > 0);
}

export function FormularioPesquisa({
  criteria, onChange, opcoes, carregandoOpcoes = false, desabilitado = false,
}: FormularioPesquisaProps) {
  const [avancado, setAvancado] = React.useState(false);

  const set = (campo: keyof SearchCriteria) => (valor: string) => {
    onChange({ ...criteria, [campo]: valor });
  };

  const apenasDigitos = (campo: keyof SearchCriteria) => (valor: string) => {
    onChange({ ...criteria, [campo]: valor.replace(/\D/g, '') });
  };

  const nomeParteInvalido = useMemo(() => nomePartePendente(criteria), [criteria]);
  const nomeAdvInvalido = useMemo(() => nomeAdvogadoPendente(criteria), [criteria]);

  const wrap = desabilitado ? 'pointer-events-none opacity-50' : '';

  return (
    <div className={wrap}>
      <div className="space-y-4">
        <div>
          <label className="label mb-1.5">Nome da Parte</label>
          <input
            type="text"
            value={criteria.nomeParte || ''}
            onChange={(e) => set('nomeParte')(e.target.value)}
            placeholder="Ex: Polícia Civil do Estado da Bahia"
            className="field"
          />
          {nomeParteInvalido && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle size={12} /> A pesquisa deve conter pelo menos duas palavras.
            </p>
          )}
        </div>

        <div>
          <label className="label mb-1.5">Número do processo (por comarca)</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <input type="text" inputMode="numeric" maxLength={7} value={criteria.numeroSequencial || ''} onChange={(e) => apenasDigitos('numeroSequencial')(e.target.value)} placeholder="Sequencial" className="field" />
            <input type="text" inputMode="numeric" maxLength={2} value={criteria.numeroDigito || ''} onChange={(e) => apenasDigitos('numeroDigito')(e.target.value)} placeholder="Díg." className="field" />
            <input type="text" inputMode="numeric" maxLength={4} value={criteria.numeroAno || ''} onChange={(e) => apenasDigitos('numeroAno')(e.target.value)} placeholder="Ano" className="field" />
            <input type="text" inputMode="numeric" maxLength={2} value={criteria.numeroTribunal || ''} onChange={(e) => apenasDigitos('numeroTribunal')(e.target.value)} placeholder="UF Trib." className="field" />
            <input type="text" inputMode="numeric" maxLength={4} value={criteria.numeroOrgao || ''} onChange={(e) => apenasDigitos('numeroOrgao')(e.target.value)} placeholder="Comarca" className="field" />
          </div>
          <p className="mt-1 text-xs text-slate-400">Ramo da Justiça fixo (8). Preencha apenas o que tiver — a busca por comarca dispensa o número completo.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label mb-1.5">Jurisdição</label>
            <select
              value={criteria.jurisdicao || ''}
              onChange={(e) => set('jurisdicao')(e.target.value)}
              className="field"
              disabled={carregandoOpcoes}
            >
              <option value="">{carregandoOpcoes ? 'Carregando…' : 'Selecione'}</option>
              {opcoes.jurisdicoes.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label mb-1.5">Órgão Julgador</label>
            <select
              value={criteria.orgaoJulgador || ''}
              onChange={(e) => set('orgaoJulgador')(e.target.value)}
              className="field"
              disabled={carregandoOpcoes}
            >
              <option value="">{carregandoOpcoes ? 'Carregando…' : 'Selecione'}</option>
              {opcoes.orgaosJulgadores.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label mb-1.5">Classe judicial</label>
            <input type="text" value={criteria.classeJudicial || ''} onChange={(e) => set('classeJudicial')(e.target.value)} className="field" />
          </div>
          <div>
            <label className="label mb-1.5">Assunto</label>
            <input type="text" value={criteria.assunto || ''} onChange={(e) => set('assunto')(e.target.value)} className="field" />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setAvancado(!avancado)}
        className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-500 transition-colors hover:border-slate-300"
      >
        <span>{avancado ? 'Ocultar filtros avançados' : 'Mostrar filtros avançados'}</span>
        {avancado ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {avancado && (
        <div className="mt-4 space-y-4 animate-fade">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label mb-1.5">Outros nomes / Alcunha</label>
              <input type="text" value={criteria.outrosNomes || ''} onChange={(e) => set('outrosNomes')(e.target.value)} className="field" />
            </div>
            <div>
              <label className="label mb-1.5">Nome do Representante</label>
              <input type="text" value={criteria.nomeAdvogado || ''} onChange={(e) => set('nomeAdvogado')(e.target.value)} className="field" />
              {nomeAdvInvalido && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle size={12} /> A pesquisa deve conter pelo menos duas palavras.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label mb-1.5">Documento da parte (CPF/CNPJ)</label>
              <input type="text" value={criteria.documentoParte || ''} onChange={(e) => set('documentoParte')(e.target.value)} className="field" />
            </div>
            <div>
              <label className="label mb-1.5">Número do documento</label>
              <input type="text" value={criteria.numeroDocumento || ''} onChange={(e) => set('numeroDocumento')(e.target.value)} className="field" />
            </div>
          </div>

          <div>
            <label className="label mb-1.5">OAB</label>
            <div className="grid grid-cols-3 gap-2">
              <input type="text" maxLength={10} value={criteria.numeroOAB || ''} onChange={(e) => set('numeroOAB')(e.target.value)} placeholder="Número" className="field" />
              <input type="text" maxLength={1} value={criteria.letraOAB || ''} onChange={(e) => set('letraOAB')(e.target.value.toUpperCase())} placeholder="Letra" className="field text-center uppercase" />
              <select value={criteria.ufOAB || ''} onChange={(e) => set('ufOAB')(e.target.value)} className="field" disabled={carregandoOpcoes}>
                <option value="">UF</option>
                {opcoes.ufOab.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label mb-1.5">Data de Autuação</label>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={criteria.dataAutuacaoInicio || ''} onChange={(e) => set('dataAutuacaoInicio')(e.target.value)} placeholder="De (dd/mm/aaaa)" className="field text-center" />
              <input type="text" value={criteria.dataAutuacaoFim || ''} onChange={(e) => set('dataAutuacaoFim')(e.target.value)} placeholder="Até (dd/mm/aaaa)" className="field text-center" />
            </div>
          </div>

          <div>
            <label className="label mb-1.5">Valor da Causa</label>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={criteria.valorCausaInicial || ''} onChange={(e) => set('valorCausaInicial')(e.target.value)} placeholder="De" className="field text-center" />
              <input type="text" value={criteria.valorCausaFinal || ''} onChange={(e) => set('valorCausaFinal')(e.target.value)} placeholder="Até" className="field text-center" />
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 rounded-xl bg-navy-50 px-3.5 py-2.5 text-xs text-navy-700">
        <Search size={13} className="mt-0.5 shrink-0" />
        <span>Preencha ao menos um critério. A pesquisa usa a tela de Consulta Processual do PJE e retorna até 1000 processos.</span>
      </div>
    </div>
  );
}
