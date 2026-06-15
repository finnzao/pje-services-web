import type { PesquisaProcessoCriteria } from '../../../../shared/types';
import type { ProcessoInfo } from './strategies/download-strategy';

export interface ParsedSearchForm {
  viewState: string;
  triggerId: string;
  fields: Record<string, string>;
}

const CNJ_FULL = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
const CNJ_IN_TEXT = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
const NO_SELECTION = 'org.jboss.seam.ui.NoSelectionConverter.noSelectionValue';

const SUFFIX_MAP: Record<string, string> = {
  nomeParte: ':nomeParte',
  outrosNomes: ':outrosNomesAlcunha',
  nomeAdvogado: ':nomeAdvogado',
  documentoParte: ':documentoParte',
  assunto: ':assunto',
  classeJudicial: ':classeJudicial',
  numeroDocumento: ':numeroDocumento',
  numeroOAB: ':numeroOAB',
  letraOAB: ':letraOAB',
};

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

function isFppField(name: string): boolean {
  return name.startsWith('fPP') || name === 'tipoMascaraDocumento' || name === 'autoScroll';
}

export function parseSearchForm(html: string): ParsedSearchForm | null {
  const viewState = html.match(/javax\.faces\.ViewState[^>]+value="([^"]+)"/)?.[1];
  if (!viewState) return null;

  const triggerId =
    html.match(/executarPesquisaReCaptcha\s*=\s*function\(\)\s*\{[\s\S]{0,200}?'similarityGroupingId':'(fPP:[^']+)'/)?.[1]
    || html.match(/<script[^>]+id="(fPP:j_id\d+)"[^>]*>[\s\S]{0,80}?executarPesquisaReCaptcha/)?.[1]
    || null;
  if (!triggerId) return null;

  const fields: Record<string, string> = {};

  for (const m of html.matchAll(/<input[^>]*>/gi)) {
    const tag = m[0];
    const name = attr(tag, 'name');
    if (!name || !isFppField(name)) continue;
    const type = (attr(tag, 'type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image') continue;
    if ((type === 'radio' || type === 'checkbox') && !/\bchecked\b/i.test(tag)) continue;
    const value = attr(tag, 'value');
    fields[name] = value ?? (type === 'radio' || type === 'checkbox' ? 'on' : '');
  }

  for (const m of html.matchAll(/<select[^>]*name="(fPP[^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const name = m[1];
    const selected =
      m[2].match(/<option[^>]*\bselected\b[^>]*value="([^"]*)"/i)?.[1]
      ?? m[2].match(/value="([^"]*)"[^>]*\bselected\b/i)?.[1]
      ?? NO_SELECTION;
    fields[name] = selected;
  }

  for (const m of html.matchAll(/<textarea[^>]*name="(fPP[^"]+)"[^>]*>([\s\S]*?)<\/textarea>/gi)) {
    fields[m[1]] = m[2].trim();
  }

  return { viewState, triggerId, fields };
}

export function hasAnyCriteria(criteria: PesquisaProcessoCriteria): boolean {
  return Object.values(criteria).some((v) => typeof v === 'string' && v.trim().length > 0);
}

function findFieldKey(fields: Record<string, string>, suffix: string): string | undefined {
  return Object.keys(fields).find((k) => k.endsWith(suffix));
}

function decomposeCnj(numero: string): Record<string, string> | null {
  const trimmed = numero.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!CNJ_FULL.test(trimmed) && digits.length !== 20) return null;
  return {
    numeroSequencial: digits.slice(0, 7),
    numeroDigitoVerificador: digits.slice(7, 9),
    Ano: digits.slice(9, 13),
    ramoJustica: digits.slice(13, 14),
    respectivoTribunal: digits.slice(14, 16),
    NumeroOrgaoJustica: digits.slice(16, 20),
  };
}

function applyCriteria(fields: Record<string, string>, criteria: PesquisaProcessoCriteria): void {
  for (const [logical, suffix] of Object.entries(SUFFIX_MAP)) {
    const value = (criteria as Record<string, string | undefined>)[logical]?.trim();
    if (!value) continue;
    const key = findFieldKey(fields, suffix);
    if (key) fields[key] = value;
  }

  if (criteria.ufOAB?.trim()) {
    const key = findFieldKey(fields, 'ufOABCombo');
    if (key) fields[key] = criteria.ufOAB.trim();
  }

  if (criteria.documentoParte?.trim()) fields['tipoMascaraDocumento'] = 'on';

  if (criteria.numeroProcesso?.trim()) {
    const parts = decomposeCnj(criteria.numeroProcesso);
    if (parts) {
      for (const [suffix, value] of Object.entries(parts)) {
        const key = findFieldKey(fields, `:numeroProcesso:${suffix}`);
        if (key) fields[key] = value;
      }
    }
  }
}

export function buildSearchBody(form: ParsedSearchForm, criteria: PesquisaProcessoCriteria): URLSearchParams {
  const fields = { ...form.fields };
  applyCriteria(fields, criteria);
  fields['javax.faces.ViewState'] = form.viewState;
  fields[form.triggerId] = form.triggerId;

  const body = new URLSearchParams();
  body.set('AJAXREQUEST', '_viewRoot');
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set('AJAX:EVENTS_COUNT', '1');
  return body;
}

export function buildPageBody(form: ParsedSearchForm, criteria: PesquisaProcessoCriteria, page: number): URLSearchParams {
  const fields = { ...form.fields };
  applyCriteria(fields, criteria);
  fields['javax.faces.ViewState'] = form.viewState;
  fields['fPP:processosTable:scTabela'] = String(page);
  fields['ajaxSingle'] = 'fPP:processosTable:scTabela';

  const body = new URLSearchParams();
  body.set('AJAXREQUEST', '_viewRoot');
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set('AJAX:EVENTS_COUNT', '1');
  return body;
}

export function parseResultRows(html: string): ProcessoInfo[] {
  const out: ProcessoInfo[] = [];
  const seen = new Set<number>();

  const anchor = /id="fPP:processosTable:(\d+):j_id\d+"[^>]*\btitle="([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(html)) !== null) {
    const idProcesso = parseInt(m[1], 10);
    const numero = (m[2].match(CNJ_IN_TEXT) || [])[0];
    if (!numero || seen.has(idProcesso)) continue;
    seen.add(idProcesso);
    out.push({ idProcesso, numeroProcesso: numero });
  }

  if (out.length === 0) {
    const linkText = /id="fPP:processosTable:(\d+):j_id\d+"[^>]*>([^<]*)</gi;
    while ((m = linkText.exec(html)) !== null) {
      const idProcesso = parseInt(m[1], 10);
      const numero = (m[2].match(CNJ_IN_TEXT) || [])[0];
      if (!numero || seen.has(idProcesso)) continue;
      seen.add(idProcesso);
      out.push({ idProcesso, numeroProcesso: numero });
    }
  }

  return out;
}

export function extractTotalPages(html: string): number {
  const nums: number[] = [];
  for (const m of html.matchAll(/rich-datascr-(?:act|inact)[^>]*>(\d+)</g)) nums.push(parseInt(m[1], 10));
  return nums.length > 0 ? Math.max(...nums) : 1;
}
