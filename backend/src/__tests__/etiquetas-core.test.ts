import { describe, expect, it } from 'vitest';
import {
  CONFIG_PADRAO, DIAS_PARADO_PADRAO, decidirProcesso, dedupTarefas, deveExecutarAgora,
  normalizarLista, planejarAcoes, possuiEtiqueta, proximaOcorrencia, validarConfig,
  type ContextoDecisao,
} from '../modules/etiquetas/etiquetas-core';
import type { ProcessoAcervo } from '../modules/etiquetas/types';

const AGORA = new Date('2026-09-14T12:00:00');

function diasAtras(dias: number): string {
  return new Date(AGORA.getTime() - dias * 86_400_000).toISOString();
}

function proc(overrides: Partial<ProcessoAcervo> = {}): ProcessoAcervo {
  return {
    idProcesso: 1, numeroProcesso: '8000001-11.2024.8.05.0001',
    tarefaAtual: 'Análise', outrasTarefas: [], etiquetas: [],
    dataUltimoMovimento: diasAtras(200),
    ...overrides,
  };
}

function ctx(overrides: Partial<ContextoDecisao> = {}): ContextoDecisao {
  return {
    diasParado: 120, etiquetaNome: 'PARADO_120', ignoradasNorm: normalizarLista(['Aguardando prazo']),
    removerQuandoMovimentado: false, excluidos: new Set(), agora: AGORA,
    ...overrides,
  };
}

describe('validarConfig', () => {
  it('padrão tem 120 dias, rotina desligada e sem etiqueta', () => {
    expect(CONFIG_PADRAO.diasParado).toBe(DIAS_PARADO_PADRAO);
    expect(CONFIG_PADRAO.diasParado).toBe(120);
    expect(CONFIG_PADRAO.ativo).toBe(false);
    expect(CONFIG_PADRAO.etiqueta).toBeNull();
  });

  it('aplica patch parcial mantendo o restante', () => {
    const { config, erros } = validarConfig({ diasParado: 90 }, CONFIG_PADRAO);
    expect(erros).toEqual([]);
    expect(config?.diasParado).toBe(90);
    expect(config?.horaExecucao).toBe(CONFIG_PADRAO.horaExecucao);
  });

  it('rejeita diasParado inválido e hora fora do formato', () => {
    expect(validarConfig({ diasParado: 0 }, CONFIG_PADRAO).erros).toHaveLength(1);
    expect(validarConfig({ diasParado: 'abc' }, CONFIG_PADRAO).erros).toHaveLength(1);
    expect(validarConfig({ horaExecucao: '25:00' }, CONFIG_PADRAO).erros).toHaveLength(1);
    expect(validarConfig({ horaExecucao: '03:30' }, CONFIG_PADRAO).config?.horaExecucao).toBe('03:30');
  });

  it('não deixa ativar a rotina sem etiqueta configurada', () => {
    const { config, erros } = validarConfig({ ativo: true }, CONFIG_PADRAO);
    expect(config).toBeUndefined();
    expect(erros[0]).toMatch(/etiqueta/);
    const ok = validarConfig({ ativo: true, etiqueta: { id: 10, nome: 'PARADO' } }, CONFIG_PADRAO);
    expect(ok.config?.ativo).toBe(true);
    expect(ok.config?.etiqueta).toEqual({ id: 10, nome: 'PARADO' });
  });

  it('valida etiqueta e tarefasIgnoradas', () => {
    expect(validarConfig({ etiqueta: { id: 'x', nome: '' } }, CONFIG_PADRAO).erros).toHaveLength(1);
    expect(validarConfig({ tarefasIgnoradas: 'nao-lista' }, CONFIG_PADRAO).erros).toHaveLength(1);
    const r = validarConfig({ tarefasIgnoradas: [' Aguardando prazo', 'aguardando PRAZO', '', 'Outra'] }, CONFIG_PADRAO);
    expect(r.config?.tarefasIgnoradas).toEqual(['Aguardando prazo', 'Outra']);
  });

  it('normaliza sessão (cpf só dígitos, remoção com null)', () => {
    const r = validarConfig({ sessao: { pjeSessionId: 'pje_1_abc', cpf: '123.456.789-01' } }, CONFIG_PADRAO);
    expect(r.config?.sessao).toEqual({ pjeSessionId: 'pje_1_abc', cpf: '12345678901' });
    const r2 = validarConfig({ sessao: { pjeSessionId: null } }, r.config!);
    expect(r2.config?.sessao).toEqual({ cpf: '12345678901' });
  });
});

describe('dedupTarefas / possuiEtiqueta', () => {
  it('ignora acento e caixa', () => {
    expect(dedupTarefas(['Análise', 'analise', 'ANÁLISE ']).length).toBe(1);
    expect(possuiEtiqueta(['parado_120'], 'PARADO_120')).toBe(true);
    expect(possuiEtiqueta(['outra'], 'PARADO_120')).toBe(false);
  });
});

describe('decidirProcesso', () => {
  it('etiqueta processo parado há mais de X dias', () => {
    expect(decidirProcesso(proc({ dataUltimoMovimento: diasAtras(121) }), ctx())).toEqual({ acao: 'INSERIR', diasParados: 121 });
  });

  it('exatamente X dias NÃO é "mais de X"', () => {
    expect(decidirProcesso(proc({ dataUltimoMovimento: diasAtras(120) }), ctx())).toMatchObject({ acao: 'IGNORAR', motivo: 'DENTRO_DO_PRAZO' });
  });

  it('respeita o parâmetro diasParado', () => {
    expect(decidirProcesso(proc({ dataUltimoMovimento: diasAtras(61) }), ctx({ diasParado: 60 })).acao).toBe('INSERIR');
    expect(decidirProcesso(proc({ dataUltimoMovimento: diasAtras(61) }), ctx({ diasParado: 120 })).acao).toBe('IGNORAR');
  });

  it('nunca etiqueta processo em tarefa ignorada (atual, outra ou lista externa)', () => {
    const c = ctx();
    expect(decidirProcesso(proc({ tarefaAtual: 'Aguardando Prazo' }), c)).toMatchObject({ acao: 'IGNORAR', motivo: 'TAREFA_IGNORADA' });
    expect(decidirProcesso(proc({ outrasTarefas: ['aguardando prazo'] }), c)).toMatchObject({ acao: 'IGNORAR', motivo: 'TAREFA_IGNORADA' });
    expect(decidirProcesso(proc({ idProcesso: 99 }), ctx({ excluidos: new Set([99]) }))).toMatchObject({ acao: 'IGNORAR', motivo: 'TAREFA_IGNORADA' });
  });

  it('tarefa ignorada prevalece sobre a etiqueta já aplicada e sobre a remoção', () => {
    const c = ctx({ removerQuandoMovimentado: true });
    const p = proc({ tarefaAtual: 'Aguardando prazo', etiquetas: ['PARADO_120'], dataUltimoMovimento: diasAtras(1) });
    expect(decidirProcesso(p, c)).toMatchObject({ acao: 'IGNORAR', motivo: 'TAREFA_IGNORADA' });
  });

  it('sem data de movimentação não decide (não usa dataChegada)', () => {
    const p = proc({ dataUltimoMovimento: undefined, dataChegada: diasAtras(400) });
    expect(decidirProcesso(p, ctx())).toMatchObject({ acao: 'IGNORAR', motivo: 'SEM_DATA_MOVIMENTO', diasParados: null });
  });

  it('é idempotente: já etiquetado não insere de novo', () => {
    expect(decidirProcesso(proc({ etiquetas: ['Parado_120'] }), ctx())).toMatchObject({ acao: 'IGNORAR', motivo: 'JA_ETIQUETADO' });
  });

  it('remove a etiqueta de quem voltou a movimentar só com removerQuandoMovimentado', () => {
    const p = proc({ etiquetas: ['PARADO_120'], dataUltimoMovimento: diasAtras(3) });
    expect(decidirProcesso(p, ctx()).acao).toBe('IGNORAR');
    expect(decidirProcesso(p, ctx({ removerQuandoMovimentado: true }))).toEqual({ acao: 'REMOVER', diasParados: 3 });
  });
});

describe('planejarAcoes', () => {
  it('ordena inserções do mais parado para o menos e contabiliza ignorados', () => {
    const lista = [
      proc({ idProcesso: 1, dataUltimoMovimento: diasAtras(130) }),
      proc({ idProcesso: 2, dataUltimoMovimento: diasAtras(400) }),
      proc({ idProcesso: 3, dataUltimoMovimento: diasAtras(10) }),
      proc({ idProcesso: 4, tarefaAtual: 'Aguardando prazo', dataUltimoMovimento: diasAtras(500) }),
      proc({ idProcesso: 5, dataUltimoMovimento: undefined }),
    ];
    const plano = planejarAcoes(lista, ctx(), 500);
    expect(plano.inserir.map((i) => i.proc.idProcesso)).toEqual([2, 1]);
    expect(plano.remover).toEqual([]);
    expect(plano.ignorados).toEqual({ TAREFA_IGNORADA: 1, SEM_DATA_MOVIMENTO: 1, DENTRO_DO_PRAZO: 1, JA_ETIQUETADO: 0, LIMITE_EXECUCAO: 0 });
  });

  it('aplica o teto por execução priorizando inserções', () => {
    const lista = [
      proc({ idProcesso: 1, dataUltimoMovimento: diasAtras(130) }),
      proc({ idProcesso: 2, dataUltimoMovimento: diasAtras(400) }),
      proc({ idProcesso: 3, dataUltimoMovimento: diasAtras(300) }),
      proc({ idProcesso: 4, etiquetas: ['PARADO_120'], dataUltimoMovimento: diasAtras(1) }),
    ];
    const plano = planejarAcoes(lista, ctx({ removerQuandoMovimentado: true }), 2);
    expect(plano.inserir.map((i) => i.proc.idProcesso)).toEqual([2, 3]);
    expect(plano.remover).toEqual([]);
    expect(plano.ignorados.LIMITE_EXECUCAO).toBe(2);
  });
});

describe('agendamento', () => {
  it('proximaOcorrencia vai para amanhã quando a hora já passou', () => {
    const prox = proximaOcorrencia('03:00', new Date('2026-09-14T12:00:00'));
    expect(prox.getDate()).toBe(15);
    expect(prox.getHours()).toBe(3);
    const hoje = proximaOcorrencia('15:30', new Date('2026-09-14T12:00:00'));
    expect(hoje.getDate()).toBe(14);
    expect(hoje.getMinutes()).toBe(30);
  });

  it('deveExecutarAgora dispara uma vez por dia após o horário, tolerando ticks perdidos', () => {
    expect(deveExecutarAgora('03:00', new Date('2026-09-14T02:59:00'))).toBe(false);
    expect(deveExecutarAgora('03:00', new Date('2026-09-14T03:00:00'))).toBe(true);
    expect(deveExecutarAgora('03:00', new Date('2026-09-14T09:45:00'))).toBe(true);
    expect(deveExecutarAgora('03:00', new Date('2026-09-14T09:45:00'), new Date('2026-09-14T03:00:30').toISOString())).toBe(false);
    expect(deveExecutarAgora('03:00', new Date('2026-09-14T09:45:00'), new Date('2026-09-13T03:00:30').toISOString())).toBe(true);
    expect(deveExecutarAgora('bad', new Date('2026-09-14T09:45:00'))).toBe(false);
  });
});
