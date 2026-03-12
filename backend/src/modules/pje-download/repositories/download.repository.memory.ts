import type { PJEDownloadMode, PJEJobStatus, PJEDownloadedFile, PJEDownloadError, DownloadJobResponse } from '../../../shared/types';
import type { IDownloadRepository, CreateJobParams, UpdateJobParams } from './download.repository';

interface StoredJob {
  id: string; userId: number; mode: PJEDownloadMode; params: Record<string, unknown>;
  status: PJEJobStatus; progress: number; totalProcesses: number; successCount: number;
  failureCount: number; files: PJEDownloadedFile[]; errors: PJEDownloadError[];
  createdAt: Date; updatedAt: Date; startedAt?: Date; completedAt?: Date;
}

const ACTIVE_STATUSES: PJEJobStatus[] = ['pending', 'authenticating', 'awaiting_2fa', 'selecting_profile', 'processing', 'downloading', 'checking_integrity', 'retrying'];

export class MemoryDownloadRepository implements IDownloadRepository {
  private jobs = new Map<string, StoredJob>();
  private audit = new Map<string, unknown[]>();

  async createJob(params: CreateJobParams): Promise<DownloadJobResponse> {
    const now = new Date();
    const job: StoredJob = { id: params.id, userId: params.userId, mode: params.mode as PJEDownloadMode, params: params.params, status: 'pending', progress: 0, totalProcesses: 0, successCount: 0, failureCount: 0, files: [], errors: [], createdAt: now, updatedAt: now };
    this.jobs.set(params.id, job);
    return this.toResponse(job);
  }

  async findJobById(id: string): Promise<DownloadJobResponse | null> { const job = this.jobs.get(id); return job ? this.toResponse(job) : null; }

  async findJobsByUser(userId: number, limit = 20, offset = 0): Promise<{ jobs: DownloadJobResponse[]; total: number }> {
    const userJobs = [...this.jobs.values()].filter((j) => j.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { jobs: userJobs.slice(offset, offset + limit).map((j) => this.toResponse(j)), total: userJobs.length };
  }

  async updateJob(params: UpdateJobParams): Promise<void> {
    const job = this.jobs.get(params.id); if (!job) return;
    if (params.status !== undefined) job.status = params.status;
    if (params.progress !== undefined) job.progress = params.progress;
    if (params.totalProcesses !== undefined) job.totalProcesses = params.totalProcesses;
    if (params.successCount !== undefined) job.successCount = params.successCount;
    if (params.failureCount !== undefined) job.failureCount = params.failureCount;
    if (params.files !== undefined) job.files = params.files;
    if (params.errors !== undefined) job.errors = params.errors;
    if (params.startedAt !== undefined) job.startedAt = params.startedAt;
    if (params.completedAt !== undefined) job.completedAt = params.completedAt;
    job.updatedAt = new Date();
  }

  async countActiveJobsByUser(userId: number): Promise<number> {
    return [...this.jobs.values()].filter((j) => j.userId === userId && ACTIVE_STATUSES.includes(j.status)).length;
  }
  async findAuditByJob(jobId: string): Promise<unknown[]> { return this.audit.get(jobId) ?? []; }

  private toResponse(job: StoredJob): DownloadJobResponse {
    return { id: job.id, userId: job.userId, mode: job.mode, status: job.status, progress: job.progress, totalProcesses: job.totalProcesses, successCount: job.successCount, failureCount: job.failureCount, files: job.files, errors: job.errors, createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString(), completedAt: job.completedAt?.toISOString(), params: job.params } as DownloadJobResponse & { params: Record<string, unknown> };
  }
}
