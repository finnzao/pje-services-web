export const PJE_REQUEST_TIMEOUT_MS = 60000;

export function requestSignal(signal?: AbortSignal, timeoutMs = PJE_REQUEST_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); resolve(); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}
