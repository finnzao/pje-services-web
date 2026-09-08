import { describe, it, expect } from 'vitest';
import {
  extractProfilesFromHtml, extractProfileSelectId, extractProfileFormFields, extractScrollerInfo,
} from '../modules/pje-download/services/pje-auth/profile-extractor';

// Fragmento real de dev.seam (deploy de 09/2026, ids j_id79/81/83/85)
const HTML = `<div id="papeisUsuarioForm:j_id71"><table><tbody><tr><td><input type="text" name="papeisUsuarioForm:j_id73" class="suggest"></td></tr></tbody></table>
<table class="rich-table " id="papeisUsuarioForm:dtPerfil"><thead class="rich-table-thead"><tr class="rich-table-header  "><th id="papeisUsuarioForm:dtPerfil:perfilInicialHeader"><a href="#" id="papeisUsuarioForm:dtPerfil:j_id76" onclick="A4J.AJAX.Submit('papeisUsuarioForm',event,{});return false;"><img src="/pje/img/localizacao/favorite-16x16.png"></a></th><th id="papeisUsuarioForm:dtPerfil:j_id78">
<script type="text/javascript">function jsfcljs(f, pvp, t) {}</script>
<a href="#" onclick="if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('papeisUsuarioForm'),{'papeisUsuarioForm:dtPerfil:j_id79':'papeisUsuarioForm:dtPerfil:j_id79'},'');}return false">VARA CRIMINAL DE RIO REAL / Direção de Secretaria / Diretor de Secretaria</a></th></tr></thead><tbody id="papeisUsuarioForm:dtPerfil:tb"><tr class="rich-table-row rich-table-firstrow "><td id="papeisUsuarioForm:dtPerfil:0:perfilInicial"><a href="#" id="papeisUsuarioForm:dtPerfil:0:j_id81"><img src="/pje/img/localizacao/favorite-16x16-disabled.png"></a></td><td class="rich-table-cell " id="papeisUsuarioForm:dtPerfil:0:colPerfil"><a href="#" onclick="if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('papeisUsuarioForm'),{'papeisUsuarioForm:dtPerfil:0:j_id83':'papeisUsuarioForm:dtPerfil:0:j_id83'},'');}return false">V DOS FEITOS DE REL DE CONS CIV E COMERCIAIS DE RIO REAL / Assessoria / Assessor</a></td></tr><tr class="rich-table-row "><td id="papeisUsuarioForm:dtPerfil:1:perfilInicial"><a href="#" id="papeisUsuarioForm:dtPerfil:1:j_id81"><img src="/pje/img/localizacao/favorite-16x16-disabled.png"></a></td><td class="rich-table-cell " id="papeisUsuarioForm:dtPerfil:1:colPerfil"><a href="#" onclick="if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('papeisUsuarioForm'),{'papeisUsuarioForm:dtPerfil:1:j_id83':'papeisUsuarioForm:dtPerfil:1:j_id83'},'');}return false">V DOS FEITOS DE REL DE CONS CIV E COMERCIAIS DE RIO REAL / Direção de Secretaria / Diretor de Secretaria</a></td></tr><tr class="rich-table-row "><td id="papeisUsuarioForm:dtPerfil:2:perfilInicial"><a href="#" id="papeisUsuarioForm:dtPerfil:2:j_id81"><img src="/pje/img/localizacao/favorite-16x16-disabled.png"></a></td><td class="rich-table-cell " id="papeisUsuarioForm:dtPerfil:2:colPerfil"><a href="#" onclick="if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('papeisUsuarioForm'),{'papeisUsuarioForm:dtPerfil:2:j_id83':'papeisUsuarioForm:dtPerfil:2:j_id83'},'');}return false">VARA CRIMINAL DE RIO REAL / Assessoria / Assessor</a></td></tr></tbody></table>
<input type="hidden" name="papeisUsuarioForm:j_id85" value="papeisUsuarioForm:j_id85">
<div class="rich-datascr " id="papeisUsuarioForm:j_id85:scPerfil" style="display: none"></div><input type="hidden" name="javax.faces.ViewState" id="javax.faces.ViewState" value="j_id19"></div>`;

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
