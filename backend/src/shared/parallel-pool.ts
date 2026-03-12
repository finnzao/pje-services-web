export class ParallelPool {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly concurrency: number) {}
  async add<T>(fn: () => Promise<T>): Promise<void> {
    if (this.running >= this.concurrency) { await new Promise<void>((r) => this.queue.push(r)); }
    this.running++;
    fn().catch(() => {}).finally(() => { this.running--; const n = this.queue.shift(); if (n) n(); });
  }
  async drain(): Promise<void> {
    while (this.running > 0) {
      await new Promise<void>((r) => { if (this.running === 0) { r(); } else { const i = setInterval(() => { if (this.running === 0) { clearInterval(i); r(); } }, 50); } });
    }
  }
  get activeCount(): number { return this.running; }
  get pendingCount(): number { return this.queue.length; }
}
