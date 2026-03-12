import type { DownloadStrategy, ProcessoInfo } from './download-strategy';
import type { PjeSession } from '../../../../../shared/pje-api-client';

export class ByNumberStrategy implements DownloadStrategy {
  async listProcesses(
    _session: PjeSession,
    params: Record<string, unknown>,
    _onCancelled: () => boolean,
  ): Promise<ProcessoInfo[]> {
    const numbers: string[] = (params.processNumbers as string[]) || [];
    return numbers.map((num) => ({
      idProcesso: 0,
      numeroProcesso: num,
    }));
  }
}
