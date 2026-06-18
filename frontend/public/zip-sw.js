self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const downloads = new Map();

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'ZIP_DOWNLOAD') return;
  const port = event.ports[0];
  if (!port) return;

  const filename = String(data.filename || 'download.zip').replace(/"/g, '');
  const downloadUrl = self.registration.scope + '__zip_download__/' + data.id + '/' + encodeURIComponent(filename);

  const stream = new ReadableStream({
    pull(controller) {
      return new Promise((resolve) => {
        port.onmessage = (e) => {
          const msg = e.data;
          if (msg === 'end') {
            controller.close();
            resolve();
          } else if (msg && msg.error) {
            controller.error(new Error(msg.error));
            resolve();
          } else {
            controller.enqueue(msg);
            resolve();
          }
        };
        port.postMessage('pull');
      });
    },
    cancel() {
      try { port.postMessage('cancel'); } catch (e) { void e; }
    },
  });

  downloads.set(downloadUrl, { stream, filename });
  port.postMessage({ downloadUrl });
});

self.addEventListener('fetch', (event) => {
  const entry = downloads.get(event.request.url);
  if (!entry) return;
  downloads.delete(event.request.url);

  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="' + entry.filename + '"',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  event.respondWith(new Response(entry.stream, { headers }));
});
