export class Slots {
  private active = 0;
  private waiters: (() => void)[] = [];
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  async run<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener("abort", cancel);
        this.active++;
        resolve();
      };
      const cancel = () => {
        this.waiters = this.waiters.filter((w) => w !== grant);
        reject(signal.reason);
      };
      if (this.active < this.limit) grant();
      else {
        this.waiters.push(grant);
        signal.addEventListener("abort", cancel, { once: true });
      }
    });
    try {
      signal.throwIfAborted();
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}
