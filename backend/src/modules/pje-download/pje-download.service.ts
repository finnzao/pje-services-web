import { randomUUID } from 'node:crypto';
import {
  PJE_MAX_CONCURRENT_JOBS,
  type CreateDownloadJobDTO,
  type Submit2FADTO,
  type DownloadJobResponse,
  type PJEDownloadProgress,
  type PJEJobStatus,
} from 'shared';
import type { IDownloadRepository } from '../repositories/download.repository';
import { AppError } from '../../../shared/errors';

export class PJEDownloadService {
  private twoFaCodes = new Map<string, { code: string; expiresAt: number }>();
  private progressMap = new Map<string, PJEDownloadProgress>();
  private cancelFlags = new Set<string>();

  constructor(private repository: IDownloadRepository) {}

  async createJob(userId: number, userName: string, dto: CreateDownloadJobDTO): Promise<DownloadJobResponse> {
    this.validateDTO(dto);

    const activeCount = await this.repository.countActiveJobsByUser(userId);
    if (activeCount >= PJE_MAX_CONCURRENT_JOBS)
      throw new AppError('LIMIT_EXCEEDED', `Limite de ${PJE_MAX_CONCURRENT_JOBS} downloads simultâneos atingido.`, 429);

    const jobId = randomUUID();
    const isFavorite = dto.isFavorite === true;

    const job = await this.repository.createJob({
      id: jobId, userId, mode: dto.mode,
      params: {
        credentials: { cpf: dto.credentials.cpf, password: dto.credentials.password },
        processNumbers: dto.processNumbers, taskName: dto.taskName,
        isFavorite, tagId: dto.tagId, tagName: dto.tagName,
        documentType: dto.documentType, pjeProfileIndex: dto.pjeProfileIndex,
        pjeSessionId: (dto as any).pjeSessionId,
      },
    });

    console.log(`[PJE] Job ${jobId.slice(0, 8)} criado | usuário=${userName} modo=${dto.mode}`);
    return job;
  }

  async getJob(jobId: string, userId: number): Promise<DownloadJobResponse> {
    if (!jobId || typeof jobId !== 'string')
      throw new AppError('INVALID_PARAM', 'ID do job é obrigatório.', 400);
    const job = await this.repository.findJobById(jobId);
    if (!job || job.userId !== userId)
      throw new AppError('NOT_FOUND', `Job "${jobId.slice(0, 8)}..." não encontrado.`, 404);
    return job;
  }

  async listJobs(userId: number, limit = 20, offset = 0) {
    return this.repository.findJobsByUser(userId, Math.min(Math.max(1, limit), 100), Math.max(0, offset));
  }

  async submit2FA(jobId: string, userId: number, dto: Submit2FADTO): Promise<void> {
    const job = await this.getJob(jobId, userId);
    if (job.status !== 'awaiting_2fa')
      throw new AppError('INVALID_STATE', `Job não aguarda 2FA (status: ${job.status}).`, 409);
    if (!dto.code || !/^\d{6}$/.test(dto.code))
      throw new AppError('INVALID_CODE', 'Código 2FA deve ter 6 dígitos.', 400);
    this.twoFaCodes.set(jobId, { code: dto.code, expiresAt: Date.now() + 5 * 60 * 1000 });
  }

  get2FACode(jobId: string): string | null {
    const entry = this.twoFaCodes.get(jobId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.twoFaCodes.delete(jobId); return null; }
    return entry.code;
  }

  async cancelJob(jobId: string, userId: number): Promise<void> {
    const job = await this.getJob(jobId, userId);
    const cancellable: PJEJobStatus[] = ['pending', 'authenticating', 'awaiting_2fa', 'selecting_profile', 'processing', 'downloading'];
    if (!cancellable.includes(job.status))
      throw new AppError('INVALID_STATE', `Não é possível cancelar job com status "${job.status}".`, 409);
    this.cancelFlags.add(jobId);
    await this.repository.updateJob({ id: jobId, status: 'cancelled' });
  }

  isCancelled(jobId: string): boolean { return this.cancelFlags.has(jobId); }

  async getProgress(jobId: string): Promise<PJEDownloadProgress | null> { return this.progressMap.get(jobId) ?? null; }
  setProgress(jobId: string, progress: PJEDownloadProgress): void { this.progressMap.set(jobId, progress); }

  async getFiles(jobId: string, userId: number) { return (await this.getJob(jobId, userId)).files; }
  async getAudit(jobId: string, userId: number) { await this.getJob(jobId, userId); return this.repository.findAuditByJob(jobId); }

  private validateDTO(dto: CreateDownloadJobDTO): void {
    if (!dto) throw new AppError('INVALID_BODY', 'Corpo da requisição é obrigatório.', 400);
    if (!dto.credentials?.cpf || !dto.credentials?.password)
      throw new AppError('MISSING_CREDENTIALS', 'CPF e senha do PJE são obrigatórios.', 400);
    if (dto.credentials.cpf.replace(/\D/g, '').length !== 11)
      throw new AppError('INVALID_CPF', 'CPF deve ter exatamente 11 dígitos.', 400);
    if (!dto.mode) throw new AppError('MISSING_PARAMS', 'O modo de download é obrigatório.', 400);

    const validModes = ['by_number', 'by_task', 'by_tag'];
    if (!validModes.includes(dto.mode))
      throw new AppError('INVALID_MODE', `Modo "${dto.mode}" inválido.`, 400);

    if (dto.mode === 'by_number') {
      if (!dto.processNumbers?.length) throw new AppError('MISSING_PARAMS', 'Informe ao menos um número de processo.', 400);
      if (dto.processNumbers.length > 500) throw new AppError('LIMIT_EXCEEDED', `Máximo 500 processos.`, 400);
      const cnjPattern = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;
      const invalid = dto.processNumbers.filter((n) => !cnjPattern.test(n));
      if (invalid.length > 0)
        throw new AppError('INVALID_PROCESS_NUMBER', `${invalid.length} número(s) inválido(s): ${invalid.slice(0, 3).join(', ')}`, 400);
    }
    if (dto.mode === 'by_task' && !dto.taskName?.trim())
      throw new AppError('MISSING_PARAMS', 'Informe o nome da tarefa.', 400);
    if (dto.mode === 'by_tag' && !dto.tagId && !dto.tagName?.trim())
      throw new AppError('MISSING_PARAMS', 'Informe o ID ou nome da etiqueta.', 400);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.twoFaCodes)
      if (now > entry.expiresAt) this.twoFaCodes.delete(key);
    const oneDayAgo = now - 86_400_000;
    for (const [key, progress] of this.progressMap)
      if (progress.timestamp && progress.timestamp < oneDayAgo) this.progressMap.delete(key);
  }
}

export type { IDownloadRepository as IPJEDownloadRepository } from '../repositories/download.repository';
