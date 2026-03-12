import type { PjeSession } from '../../../../../shared/pje-api-client';

export interface ProcessoInfo {
  idProcesso: number;
  numeroProcesso: string;
  idTaskInstance?: number;
}

export interface DownloadStrategy {
  listProcesses(
    session: PjeSession,
    params: Record<string, unknown>,
    onCancelled: () => boolean,
  ): Promise<ProcessoInfo[]>;
}
