import type { PJEJobStatus, PJEDownloadedFile, PJEDownloadError, DownloadJobResponse } from '../../../shared/types';

export interface CreateJobParams { id: string; userId: number; mode: string; params: Record<string, unknown>; }
export interface UpdateJobParams { id: string; status?: PJEJobStatus; progress?: number; totalProcesses?: number; successCount?: number; failureCount?: number; files?: PJEDownloadedFile[]; errors?: PJEDownloadError[]; startedAt?: Date; completedAt?: Date; }

export interface IDownloadRepository {
  createJob(params: CreateJobParams): Promise<DownloadJobResponse>;
  findJobById(id: string): Promise<DownloadJobResponse | null>;
  findJobsByUser(userId: number, limit: number, offset: number): Promise<{ jobs: DownloadJobResponse[]; total: number }>;
  updateJob(params: UpdateJobParams): Promise<void>;
  countActiveJobsByUser(userId: number): Promise<number>;
  findAuditByJob(jobId: string): Promise<unknown[]>;
}
