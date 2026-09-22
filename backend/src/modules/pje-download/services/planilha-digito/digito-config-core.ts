import type { ConfigAutomacaoDigito, ModoDigito, ServidorConfigDigito } from '../../../../shared/types';
import { normalizarTexto } from './digito-core';

export const CONFIG_DIGITO_VERSAO = 1;
const MAX_SERVIDORES = 50;
const MAX_NOME = 120;
const MAX_TAREFAS = 500;
const MODOS: ModoDigito[] = ['sequencial', 'verificador1', 'verificador2'];

export interface ResultadoValidacaoDigito {
  config?: ConfigAutomacaoDigito;
  erros: string[];
}

function lerServidores(raw: unknown, erros: string[]): ServidorConfigDigito[] {
  if (!Array.isArray(raw)) { erros.push('servidores deve ser uma lista.'); return []; }
  if (raw.length > MAX_SERVIDORES) erros.push(`No máximo ${MAX_SERVIDORES} servidores.`);

  const digitosUsados = new Set<number>();
  const etiquetasUsadas = new Set<number>();
  const nomesUsados = new Set<string>();
  const out: ServidorConfigDigito[] = [];

  for (const item of raw.slice(0, MAX_SERVIDORES)) {
    const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const nome = typeof s.nome === 'string' ? s.nome.trim().slice(0, MAX_NOME) : '';
    const digitosBrutos = Array.isArray(s.digitos) ? s.digitos : [];
    const digitos: number[] = [];
    for (const d of digitosBrutos) {
      const n = Number(d);
      if (!Number.isInteger(n) || n < 0 || n > 9 || digitosUsados.has(n)) continue;
      digitosUsados.add(n);
      digitos.push(n);
    }
    digitos.sort((a, b) => a - b);

    let etiqueta: ServidorConfigDigito['etiqueta'];
    if (s.etiqueta && typeof s.etiqueta === 'object') {
      const e = s.etiqueta as Record<string, unknown>;
      const id = Number(e.id);
      const nomeTag = typeof e.nome === 'string' ? e.nome.trim() : '';
      if (Number.isInteger(id) && id > 0 && nomeTag && !etiquetasUsadas.has(id)) {
        etiquetasUsadas.add(id);
        etiqueta = { id, nome: nomeTag };
      }
    }

    // Linha vazia não vale a pena guardar; nome repetido fica só na primeira ocorrência.
    if (!nome && digitos.length === 0) continue;
    const nomeNorm = normalizarTexto(nome);
    if (nome && nomesUsados.has(nomeNorm)) { erros.push(`Servidor repetido: "${nome}".`); continue; }
    if (nome) nomesUsados.add(nomeNorm);

    out.push(etiqueta ? { nome, digitos, etiqueta } : { nome, digitos });
  }
  return out;
}

function lerTarefas(raw: unknown, erros: string[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { erros.push('tarefasIgnoradas deve ser uma lista de nomes.'); return []; }
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const norm = normalizarTexto(t);
    if (!norm || vistas.has(norm)) continue;
    vistas.add(norm);
    out.push(t.trim());
    if (out.length >= MAX_TAREFAS) break;
  }
  return out;
}

/** Normaliza e valida o corpo enviado pela tela (ou lido do disco). Nunca lança. */
export function validarConfigDigito(raw: unknown): ResultadoValidacaoDigito {
  const erros: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { erros: ['Configuração deve ser um objeto.'] };
  }
  const r = raw as Record<string, unknown>;

  const servidores = lerServidores(r.servidores, erros);
  const modoDigito = MODOS.includes(r.modoDigito as ModoDigito) ? (r.modoDigito as ModoDigito) : 'sequencial';
  if (r.modoDigito !== undefined && !MODOS.includes(r.modoDigito as ModoDigito)) erros.push('modoDigito inválido.');
  const formato = r.formato === 'zip' ? 'zip' : 'xlsx';
  if (r.formato !== undefined && r.formato !== 'xlsx' && r.formato !== 'zip') erros.push('formato deve ser xlsx ou zip.');
  const reduzida = r.reduzida === true;
  const tarefasIgnoradas = lerTarefas(r.tarefasIgnoradas, erros);

  if (erros.length > 0) return { erros };
  return {
    erros: [],
    config: {
      versao: CONFIG_DIGITO_VERSAO,
      servidores, modoDigito, tarefasIgnoradas, formato, reduzida,
      atualizadoEm: typeof r.atualizadoEm === 'string' ? r.atualizadoEm : new Date(0).toISOString(),
      atualizadoPor: typeof r.atualizadoPor === 'string' ? r.atualizadoPor : undefined,
    },
  };
}

/** Uma configuração por perfil do PJE: o mesmo CPF pode ter servidores diferentes em cada vara. */
export function chaveConfigDigito(sessao: { cpf?: string; idUsuario?: number; idUsuarioLocalizacao: string }): string {
  const dono = sessao.cpf?.replace(/\D/g, '') || (sessao.idUsuario ? `u${sessao.idUsuario}` : 'anonimo');
  return `${dono}::${sessao.idUsuarioLocalizacao}`;
}
