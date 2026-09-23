import type {
  EtiquetaServidorRef, EtiquetagemDigitoProgress, EtiquetarPorDigitoDTO, ProcessoEtiquetadoDigito,
} from '../../../../shared/types';
import type { PjeSession } from '../../../../shared/pje-api-client';
import { AppError } from '../../../../shared/errors';
import { resolveSessionFromDto } from '../pje-auth';
import {
  inserirEtiquetaNoProcesso, listarEtiquetasDoPerfil, removerEtiquetaDoProcesso,
} from '../../../etiquetas/pje-etiquetas-client';
import type { ItemEtiquetagem } from './digito-core';
import type { PlanilhaDigitoService } from './planilha-digito.service';

const APPLY_CONCURRENCY = 2;
const APPLY_STAGGER_MS = 300;
const TERMINAIS = ['completed', 'failed', 'cancelled'];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface EtiquetaAlvo extends EtiquetaServidorRef { nomePje: string; }

type Operacao =
  | { tipo: 'inserir'; item: ItemEtiquetagem; etiqueta: EtiquetaAlvo }
  | { tipo: 'remover'; item: ItemEtiquetagem; etiqueta: EtiquetaAlvo };

/**
 * Aplica no PJE o plano de etiquetagem calculado pela automação por dígito.
 * O progresso fica em memória, indexado pelo jobId da planilha.
 */
export class EtiquetagemDigitoService {
  private progressMap = new Map<string, EtiquetagemDigitoProgress>();
  private cancelados = new Set<string>();

  constructor(private planilhas: PlanilhaDigitoService) {}

  getProgress(jobId: string): EtiquetagemDigitoProgress | null { return this.progressMap.get(jobId) ?? null; }

  cancelar(jobId: string): boolean {
    const atual = this.progressMap.get(jobId);
    if (!atual || TERMINAIS.includes(atual.status)) return false;
    this.cancelados.add(jobId);
    this.progressMap.set(jobId, { ...atual, status: 'cancelling', message: 'Cancelamento solicitado — interrompendo...', timestamp: Date.now() });
    return true;
  }

  iniciar(jobId: string, dto: EtiquetarPorDigitoDTO): void {
    const planilha = this.planilhas.getProgress(jobId);
    if (!planilha || planilha.status !== 'completed') {
      throw new AppError('PLANILHA_NAO_CONCLUIDA', 'A planilha por dígito precisa estar concluída antes de etiquetar.', 409);
    }
    const plano = this.planilhas.getPlanoEtiquetagem(jobId);
    if (!plano) {
      throw new AppError('SEM_PLANO', 'Esta planilha foi gerada sem etiquetas vinculadas aos servidores.', 400);
    }
    const atual = this.progressMap.get(jobId);
    if (atual && !TERMINAIS.includes(atual.status)) {
      throw new AppError('ETIQUETAGEM_EM_ANDAMENTO', 'A etiquetagem desta planilha já está em andamento.', 409);
    }

    const total = plano.itens.reduce((n, i) => n + (i.inserir ? 1 : 0) + i.remover.length, 0);
    this.cancelados.delete(jobId);
    this.progressMap.set(jobId, {
      jobId, status: 'running', progress: 0, total, feitos: 0,
      inseridas: 0, removidas: 0, erros: 0,
      message: 'Resolvendo sessão PJE...', timestamp: Date.now(), processos: [],
    });

    void this.executar(jobId, plano.itens, plano.etiquetas, dto)
      .catch((err) => console.error(`[ETIQUETAGEM-DIGITO] Job ${jobId.slice(0, 8)} falhou:`, err instanceof Error ? err.message : err))
      .finally(() => this.cancelados.delete(jobId));
  }

  private async executar(
    jobId: string,
    itens: ItemEtiquetagem[],
    etiquetas: Map<number, EtiquetaServidorRef>,
    dto: EtiquetarPorDigitoDTO,
  ): Promise<void> {
    const emit = (patch: Partial<EtiquetagemDigitoProgress>) => {
      const atual = this.progressMap.get(jobId)!;
      this.progressMap.set(jobId, { ...atual, ...patch, timestamp: Date.now() });
    };
    const cancelado = () => this.cancelados.has(jobId);

    try {
      const session = await resolveSessionFromDto(dto);
      if (cancelado()) return emit({ status: 'cancelled', message: 'Etiquetagem cancelada.' });

      emit({ message: 'Conferindo etiquetas no perfil...' });
      const reconciliadas = await this.reconciliarEtiquetas(session, etiquetas);
      if (cancelado()) return emit({ status: 'cancelled', message: 'Etiquetagem cancelada.' });

      const fila = this.montarFila(itens, reconciliadas);
      emit({ total: fila.length, message: `Aplicando ${fila.length} alteração(ões) no PJE...` });

      await this.aplicar(session, fila, jobId, cancelado);

      const atual = this.progressMap.get(jobId)!;
      if (cancelado()) {
        emit({ status: 'cancelled', message: `Cancelada: ${atual.inseridas} inseridas, ${atual.removidas} removidas antes da interrupção.` });
        return;
      }
      emit({
        status: 'completed', progress: 100,
        message: `Concluído: ${atual.inseridas} etiqueta(s) inserida(s), ${atual.removidas} removida(s), ${atual.erros} erro(s).`,
      });
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      emit({ status: 'failed', message: `Falha: ${mensagem}` });
      throw err;
    }
  }

  private async reconciliarEtiquetas(
    session: PjeSession,
    etiquetas: Map<number, EtiquetaServidorRef>,
  ): Promise<Map<number, EtiquetaAlvo>> {
    const disponiveis = new Map((await listarEtiquetasDoPerfil(session)).map((t) => [t.id, t]));
    const out = new Map<number, EtiquetaAlvo>();
    for (const [digito, etiqueta] of etiquetas) {
      if (out.has(etiqueta.id)) continue;
      const alvo = disponiveis.get(etiqueta.id);
      if (!alvo) {
        throw new AppError('ETIQUETA_INEXISTENTE', `A etiqueta "${etiqueta.nome}" (id ${etiqueta.id}) do dígito ${digito} não existe mais no perfil da sessão.`, 422);
      }
      const completo = (alvo.nomeTagCompleto || '').trim();
      out.set(alvo.id, { id: alvo.id, nome: alvo.nomeTag, nomePje: completo || alvo.nomeTag });
    }
    return out;
  }

  private montarFila(itens: ItemEtiquetagem[], etiquetas: Map<number, EtiquetaAlvo>): Operacao[] {
    const resolver = (ref: EtiquetaServidorRef): EtiquetaAlvo => etiquetas.get(ref.id) ?? { ...ref, nomePje: ref.nome };
    const fila: Operacao[] = [];
    for (const item of itens) {
      for (const ref of item.remover) fila.push({ tipo: 'remover', item, etiqueta: resolver(ref) });
      if (item.inserir) fila.push({ tipo: 'inserir', item, etiqueta: resolver(item.inserir) });
    }
    return fila;
  }

  private async inserirPorId(session: PjeSession, op: Operacao, suspensas: Map<number, string>): Promise<void> {
    const { etiqueta, item } = op;
    const suspensa = suspensas.get(etiqueta.id);
    if (suspensa) throw new Error(suspensa);
    const { idTag } = await inserirEtiquetaNoProcesso(session, etiqueta.nomePje, item.idProcesso);
    if (idTag === etiqueta.id) return;
    const desfeito = await removerEtiquetaDoProcesso(session, idTag, item.idProcesso).then(() => true, () => false);
    if (!suspensas.has(etiqueta.id)) {
      suspensas.set(etiqueta.id, `Etiqueta "${etiqueta.nomePje}" (id ${etiqueta.id}) suspensa: o PJE não a vinculou pelo id.`);
    }
    throw new Error(`O PJE vinculou a etiqueta id ${idTag} em vez da id ${etiqueta.id} ("${etiqueta.nomePje}")${desfeito ? '; vínculo desfeito' : '; remova o vínculo manualmente'}.`);
  }

  private async aplicar(session: PjeSession, fila: Operacao[], jobId: string, cancelado: () => boolean): Promise<void> {
    let next = 0;
    const primeiras = new Map<number, Promise<unknown>>();
    const suspensas = new Map<number, string>();
    const inserir = async (op: Operacao) => {
      const primeira = primeiras.get(op.etiqueta.id);
      if (primeira) {
        await primeira;
        return this.inserirPorId(session, op, suspensas);
      }
      const tentativa = this.inserirPorId(session, op, suspensas);
      primeiras.set(op.etiqueta.id, tentativa.catch(() => undefined));
      return tentativa;
    };

    const registrar = (op: Operacao, acao: ProcessoEtiquetadoDigito['acao'], erro?: string) => {
      const atual = this.progressMap.get(jobId)!;
      const processos = [...atual.processos, {
        idProcesso: op.item.idProcesso, numeroProcesso: op.item.numeroProcesso,
        servidor: op.item.servidor, etiqueta: op.etiqueta.nome, acao, erro,
      }];
      const feitos = atual.feitos + 1;
      this.progressMap.set(jobId, {
        ...atual,
        processos,
        feitos,
        inseridas: atual.inseridas + (acao === 'inserida' ? 1 : 0),
        removidas: atual.removidas + (acao === 'removida' ? 1 : 0),
        erros: atual.erros + (acao === 'erro' ? 1 : 0),
        progress: Math.round((feitos / Math.max(1, fila.length)) * 100),
        message: `Aplicando ${feitos}/${fila.length}: ${op.item.numeroProcesso}`,
        timestamp: Date.now(),
      });
    };

    const worker = async () => {
      while (!cancelado()) {
        const idx = next++;
        if (idx >= fila.length) return;
        if (idx > 0) await sleep(APPLY_STAGGER_MS);
        const op = fila[idx];
        try {
          if (op.tipo === 'inserir') {
            await inserir(op);
            registrar(op, 'inserida');
          } else {
            await removerEtiquetaDoProcesso(session, op.etiqueta.id, op.item.idProcesso);
            registrar(op, 'removida');
          }
        } catch (err) {
          registrar(op, 'erro', err instanceof Error ? err.message : String(err));
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(APPLY_CONCURRENCY, fila.length) }, worker));
  }
}
