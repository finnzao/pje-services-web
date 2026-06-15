'use client';

import React from 'react';
import { Search, User, Hash, FileText, IdCard, Scale, Tag, Info } from 'lucide-react';
import type { SearchCriteria } from './types';

interface FormularioPesquisaProps {
  criterios: SearchCriteria;
  onChange: (criterios: SearchCriteria) => void;
  desabilitado?: boolean;
}

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

export function FormularioPesquisa({ criterios, onChange, desabilitado }: FormularioPesquisaProps) {
  const set = (campo: keyof SearchCriteria, valor: string) => onChange({ ...criterios, [campo]: valor });

  return (
    <div className={desabilitado ? 'pointer-events-none opacity-50' : ''}>
      <div className="mb-2 flex items-center gap-2">
        <Search size={14} className="text-slate-500" />
        <span className="eyebrow">Critérios de pesquisa</span>
      </div>

      <div className="mb-3 flex items-start gap-2 rounded-xl bg-navy-50 px-3.5 py-2.5 text-xs text-navy-700">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        <span>Preencha <strong>ao menos um</strong> campo. Todos os processos retornados serão baixados.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo icone={<User size={13} />} rotulo="Nome da parte">
          <input className="field" value={criterios.nomeParte || ''} onChange={(e) => set('nomeParte', e.target.value)} placeholder="Ex: João da Silva" />
        </Campo>

        <Campo icone={<IdCard size={13} />} rotulo="CPF / CNPJ da parte">
          <input className="field font-mono" value={criterios.documentoParte || ''} onChange={(e) => set('documentoParte', e.target.value)} placeholder="000.000.000-00" />
        </Campo>

        <Campo icone={<Hash size={13} />} rotulo="Número do processo (CNJ)">
          <input className="field font-mono" value={criterios.numeroProcesso || ''} onChange={(e) => set('numeroProcesso', e.target.value)} placeholder="0000000-00.0000.0.00.0000" />
        </Campo>

        <Campo icone={<User size={13} />} rotulo="Nome do advogado">
          <input className="field" value={criterios.nomeAdvogado || ''} onChange={(e) => set('nomeAdvogado', e.target.value)} placeholder="Ex: Maria Souza" />
        </Campo>

        <Campo icone={<Scale size={13} />} rotulo="OAB (nº / letra / UF)">
          <div className="flex gap-2">
            <input className="field font-mono" value={criterios.numeroOAB || ''} onChange={(e) => set('numeroOAB', e.target.value)} placeholder="Número" />
            <input className="field w-16 font-mono" maxLength={1} value={criterios.letraOAB || ''} onChange={(e) => set('letraOAB', e.target.value.toUpperCase())} placeholder="L" />
            <select className="field w-24" value={criterios.ufOAB || ''} onChange={(e) => set('ufOAB', e.target.value)}>
              <option value="">UF</option>
              {UFS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
        </Campo>

        <Campo icone={<Tag size={13} />} rotulo="Classe judicial">
          <input className="field" value={criterios.classeJudicial || ''} onChange={(e) => set('classeJudicial', e.target.value)} placeholder="Ex: Procedimento Comum" />
        </Campo>

        <Campo icone={<FileText size={13} />} rotulo="Assunto">
          <input className="field" value={criterios.assunto || ''} onChange={(e) => set('assunto', e.target.value)} placeholder="Ex: Indenização" />
        </Campo>

        <Campo icone={<User size={13} />} rotulo="Outros nomes / alcunha">
          <input className="field" value={criterios.outrosNomes || ''} onChange={(e) => set('outrosNomes', e.target.value)} placeholder="Apelido conhecido" />
        </Campo>
      </div>
    </div>
  );
}

function Campo({ icone, rotulo, children }: { icone: React.ReactNode; rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <span className="text-slate-400">{icone}</span>{rotulo}
      </span>
      {children}
    </label>
  );
}
