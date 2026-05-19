'use client';

import React, { useMemo, useCallback } from 'react';
import { Hash, AlertCircle, CheckCircle2, Wand2 } from 'lucide-react';

interface ListaProcessosProps {

  valor: string;
  onChange: (valor: string) => void;
  desabilitado?: boolean;
}

const CNJ_PATTERN = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;

export function normalizarCNJ(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (CNJ_PATTERN.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 20) return null;
  return (
    `${digits.slice(0, 7)}-${digits.slice(7, 9)}.` +
    `${digits.slice(9, 13)}.${digits.slice(13, 14)}.` +
    `${digits.slice(14, 16)}.${digits.slice(16, 20)}`
  );
}

function parseEntries(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ListaProcessos({ valor, onChange, desabilitado }: ListaProcessosProps) {
  const { entries, validos, invalidos } = useMemo(() => {
    const items = parseEntries(valor);
    const v: string[] = [];
    const i: string[] = [];
    for (const item of items) {
      const norm = normalizarCNJ(item);
      if (norm) v.push(norm);
      else i.push(item);
    }
    return { entries: items, validos: v, invalidos: i };
  }, [valor]);

  const normalizar = useCallback(() => {
    if (desabilitado) return;

    const unicos = Array.from(new Set(validos));
    const linhas = [...unicos];
    if (invalidos.length > 0) {
      linhas.push('');
      linhas.push('// Entradas que não puderam ser normalizadas:');
      for (const inv of invalidos) linhas.push(`// ${inv}`);
    }
    onChange(linhas.join('\n'));
  }, [validos, invalidos, onChange, desabilitado]);

  const limpar = useCallback(() => {
    if (desabilitado) return;
    onChange('');
  }, [onChange, desabilitado]);

  return (
    <div className={desabilitado ? 'opacity-50 pointer-events-none' : ''}>
      <div className="flex items-center gap-2 mb-2">
        <Hash size={14} className="text-slate-500" />
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Números de processo (CNJ)
        </label>
      </div>

      <p className="text-xs text-slate-500 mb-2">
        Cole um número por linha. Aceita formato <span className="font-mono">0000000-00.0000.0.00.0000</span>{' '}
        ou apenas os 20 dígitos.
      </p>

      <textarea
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`0000123-45.2024.8.05.0001
0000456-78.2024.8.05.0001
0000789-01.2024.8.05.0001`}
        rows={6}
        spellCheck={false}
        className="w-full px-3 py-2 border-2 border-slate-200 text-sm font-mono focus:border-slate-900 focus:outline-none resize-y"
      />

      {}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {validos.length > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <CheckCircle2 size={12} />
            <strong>{validos.length}</strong> válido(s)
          </span>
        )}
        {invalidos.length > 0 && (
          <span className="inline-flex items-center gap-1 text-red-600">
            <AlertCircle size={12} />
            <strong>{invalidos.length}</strong> inválido(s)
          </span>
        )}
        {entries.length === 0 && (
          <span className="text-slate-400">Cole pelo menos um número.</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={normalizar}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50"
              title="Reformata a lista para o padrão CNJ canônico"
            >
              <Wand2 size={12} /> Normalizar
            </button>
          )}
          {entries.length > 0 && (
            <button
              type="button"
              onClick={limpar}
              className="px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {}
      {invalidos.length > 0 && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 text-xs text-red-700">
          <strong>Entradas inválidas:</strong>{' '}
          {invalidos.slice(0, 3).map((i, idx) => (
            <span key={idx} className="font-mono ml-1">
              {i}
              {idx < Math.min(invalidos.length, 3) - 1 ? ',' : ''}
            </span>
          ))}
          {invalidos.length > 3 && <span> e mais {invalidos.length - 3}.</span>}
        </div>
      )}
    </div>
  );
}
