import { describe, it, expect } from 'vitest';
import { extractPolosFromHtml } from '../modules/pje-download/services/pje-advogados/html-advogados-parser';

// Estrutura real de listAutosDigitais.seam (deploy 09/2026), dados fictícios.
const parte = (id: number, texto: string, tipo: string) =>
  `<td><a href="/pje/Processo/ConsultaProcesso/Detalhe/detalheParte.seam?idProcessoTrf=1&amp;pessoaHome=X+%28${tipo}%29&amp;id=${id}" id="navbar:j_id${id}" onclick="abrirPopUpPeticao();"> <span class="">${texto} (${tipo}) </span></a>`;
const adv = (id: number, texto: string) =>
  `<ul class="tree"><div><li><small class="text-muted"><a href="/pje/Processo/ConsultaProcesso/Detalhe/detalheParte.seam?idProcessoTrf=1&amp;pessoaHome=Y+%28ADVOGADO%29&amp;id=${id}" id="navbar:j_id${id}"> <span class="">${texto} (ADVOGADO) </span></a></small></li></div></ul></td>`;

const HTML = `${'x'.repeat(600)}
<div id="poloAtivo" class="col-sm-4"><table class="table"><tbody>
<tr>${parte(1, 'MARIA DA SILVA - CPF: 000.000.000-00', 'AUTOR')}${adv(2, 'JOSE ADVOGADO - OAB BA12345 - CPF: 111.111.111-11')}</tr>
<tr>${parte(3, 'MINIST&Eacute;RIO P&Uacute;BLICO', 'AUTOR')}</td></tr>
</tbody></table></div>
<div id="poloPassivo" class="col-sm-4"><table class="table"><tbody>
<tr>${parte(4, 'BANCO EXEMPLO S/A - CNPJ: 00.000.000/0001-00', 'REU')}${adv(5, 'ANA DEFENSORA - OAB SE9A')}</tr>
</tbody></table></div>
<div id="recursosInternos"></div>`;

describe('extractPolosFromHtml', () => {
  const r = extractPolosFromHtml(HTML);

  it('captura partes com CPF/CNPJ e participação, sem misturar com representantes', () => {
    expect(r.partesPoloAtivo).toEqual([
      { nome: 'MARIA DA SILVA', documento: '000.000.000-00', tipoDocumento: 'CPF', participacao: 'AUTOR', tipoParte: 'ATIVO' },
      { nome: 'MINISTÉRIO PÚBLICO', documento: undefined, tipoDocumento: undefined, participacao: 'AUTOR', tipoParte: 'ATIVO' },
    ]);
    expect(r.partesPoloPassivo).toEqual([
      { nome: 'BANCO EXEMPLO S/A', documento: '00.000.000/0001-00', tipoDocumento: 'CNPJ', participacao: 'REU', tipoParte: 'PASSIVO' },
    ]);
  });

  it('mantém a extração de advogados', () => {
    expect(r.advogadosPoloAtivo).toEqual([
      { nome: 'JOSE ADVOGADO', oab: 'OAB BA12345', cpf: '111.111.111-11', tipoParte: 'ATIVO' },
    ]);
    expect(r.advogadosPoloPassivo).toEqual([
      { nome: 'ANA DEFENSORA', oab: 'OAB SE9A', cpf: undefined, tipoParte: 'PASSIVO' },
    ]);
  });
});
