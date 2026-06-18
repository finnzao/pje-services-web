import { createZipChunks, type ZipInput } from './zip-stream';

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

export function isServiceWorkerDownloadSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof MessageChannel !== 'undefined' &&
    typeof ReadableStream !== 'undefined'
  );
}

async function ensureServiceWorker(swUrl: string): Promise<ServiceWorker> {
  if (!isServiceWorkerDownloadSupported()) {
    throw new Error('Service Worker não é suportado neste navegador.');
  }
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register(swUrl, { scope: '/' });
  }
  const registration = await registrationPromise;
  await navigator.serviceWorker.ready;
  const active = registration.active || navigator.serviceWorker.controller;
  if (!active) throw new Error('Service Worker não ativou. Recarregue a página e tente novamente.');
  return active;
}

function makeId(): string {
  const c = (typeof crypto !== 'undefined' ? crypto : undefined) as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function saveZipViaServiceWorker(
  entries: ZipInput[],
  fileName: string,
  swUrl = '/zip-sw.js',
): Promise<void> {
  const sw = await ensureServiceWorker(swUrl);
  const iterator = createZipChunks(entries);
  const id = makeId();

  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    let iframe: HTMLIFrameElement | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      channel.port1.onmessage = null;
      window.setTimeout(() => {
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 3000);
      fn();
    };

    channel.port1.onmessage = async (event: MessageEvent) => {
      const msg = event.data;

      if (msg && typeof msg === 'object' && 'downloadUrl' in msg) {
        iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = (msg as { downloadUrl: string }).downloadUrl;
        document.body.appendChild(iframe);
        return;
      }

      if (msg === 'pull') {
        try {
          const { value, done } = await iterator.next();
          if (done) {
            channel.port1.postMessage('end');
            finish(resolve);
          } else {
            channel.port1.postMessage(value);
          }
        } catch (err) {
          channel.port1.postMessage({ error: err instanceof Error ? err.message : 'erro' });
          finish(() => reject(err instanceof Error ? err : new Error('Erro ao gerar o ZIP.')));
        }
        return;
      }

      if (msg === 'cancel') {
        try { await iterator.return?.(undefined as never); } catch { void 0; }
        finish(() => reject(new Error('Download cancelado.')));
      }
    };

    sw.postMessage({ type: 'ZIP_DOWNLOAD', id, filename: fileName }, [channel.port2]);
  });
}
