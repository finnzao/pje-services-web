import { describe, it, expect } from 'vitest';
import { balancear, classificar, janelaAnos, type LinhaPlanilha } from '../scripts/balanco-saneamento';

const linha = (n: string, ativo: string, passivo: string, tarefa: string, descricao = '', movimento = '10/03/2026, 08:00:00'): LinhaPlanilha => ({
  numero: n, classe: 'CartPrecCiv', tarefa, descricaoMovimento: descricao, ultimoMovimento: movimento,
  cadastroAtivo: ativo as LinhaPlanilha['cadastroAtivo'], cadastroPassivo: passivo as LinhaPlanilha['cadastroPassivo'], status: 'OK',
});

describe('balanco-saneamento', () => {
  const janela = janelaAnos(2, new Date('2026-09-10T12:00:00'));
  const itens = [
    linha('8000040-37.2015.8.05.0216', 'Não', 'Parcial', 'Arquivo definitivo', 'Baixa Definitiva'),
    linha('8000043-89.2015.8.05.0216', 'Sim', 'Sim', 'Arquivo definitivo'),
    linha('8000144-29.2016.8.05.0216', 'Sim', 'Não', 'Certificar decurso', 'Baixa Definitiva', '05/11/2025, 10:00:00'),
    linha('8000098-40.2016.8.05.0216', 'Sim', 'Não', 'Analisar'),
    linha('8000072-42.2016.8.05.0216', '', '', 'Arquivo definitivo'),
    linha('8000260-35.2015.8.05.0216', 'Não', 'Não', 'Arquivo definitivo', 'Baixa Definitiva', '25/01/2016, 13:29:58'),
  ].map((l) => classificar(l, janela));

  it('classifica arquivamento, janela, leitura e polo pendente', () => {
    expect(itens.map((i) => [i.arquivado, i.naJanela, i.pendencia, i.ano])).toEqual([
      [true, true, 'AMBOS', 2015], [true, true, 'NENHUMA', 2015], [true, true, 'PASSIVO', 2016],
      [false, false, 'PASSIVO', 2016], [true, true, 'NAO_LIDO', 2016], [true, false, 'AMBOS', 2015],
    ]);
  });

  it('mede o passivo dos últimos 2 anos e o cenário se todos estivessem saneados', () => {
    const b = balancear(itens, janela);
    expect(b.janela).toEqual({ desde: '2024-09-10', ate: '2026-09-10' });
    expect(b.arquivadosForaDaJanela).toBe(1);
    expect(b.arquivados).toEqual({ total: 4, saneados: 1, naoSaneados: 2, naoLidos: 1 });
    expect(b.ativos.naoSaneados).toBe(1);
    expect(b.pendenciaArquivados).toEqual({ ATIVO: 0, PASSIVO: 1, AMBOS: 1 });
    expect(b.cenario).toEqual({ contadasHoje: 1, contadasSeSaneados: 3, perdidas: 2, indiceAtual: 33.3, indiceSeSaneados: 100 });
    expect(b.porAno.map((a) => [a.ano, a.total, a.naoSaneados])).toEqual([['2025', 1, 1], ['2026', 3, 1]]);
  });
});
