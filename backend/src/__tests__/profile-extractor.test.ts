import { describe, it, expect } from 'vitest';
import {
  extractProfilesFromHtml, extractProfileSelectId, extractProfileFormFields, extractScrollerInfo,
} from '../modules/pje-download/services/pje-auth/profile-extractor';
import { HTML_PERFIS_DEV_SEAM } from './fixtures/perfis-dev-seam';

const HTML = HTML_PERFIS_DEV_SEAM;

describe('profile-extractor', () => {
  it('lista favorito do thead + perfis do tbody sem depender de j_idNN', () => {
    const profiles = extractProfilesFromHtml(HTML);
    expect(profiles.map(p => [p.indice, p.favorito, p.nome])).toEqual([
      [-1, true, 'VARA CRIMINAL DE RIO REAL / Direção de Secretaria / Diretor de Secretaria'],
      [0, false, 'V DOS FEITOS DE REL DE CONS CIV E COMERCIAIS DE RIO REAL / Assessoria / Assessor'],
      [1, false, 'V DOS FEITOS DE REL DE CONS CIV E COMERCIAIS DE RIO REAL / Direção de Secretaria / Diretor de Secretaria'],
      [2, false, 'VARA CRIMINAL DE RIO REAL / Assessoria / Assessor'],
    ]);
    expect(profiles[1].orgao).toBe('Assessoria');
  });

  it('deriva id de seleção e campos do form do HTML', () => {
    expect(extractProfileSelectId(HTML, -1)).toBe('papeisUsuarioForm:dtPerfil:j_id79');
    expect(extractProfileSelectId(HTML, 2)).toBe('papeisUsuarioForm:dtPerfil:2:j_id83');
    expect(extractProfileSelectId(HTML, 9)).toBeNull();
    expect(extractProfileFormFields(HTML)).toEqual({
      'papeisUsuarioForm:j_id73': '',
      'papeisUsuarioForm:j_id85': 'papeisUsuarioForm:j_id85',
    });
    expect(extractScrollerInfo(HTML)).toEqual({
      formId: 'papeisUsuarioForm:j_id85', scrollerId: 'papeisUsuarioForm:j_id85:scPerfil',
    });
  });
});
