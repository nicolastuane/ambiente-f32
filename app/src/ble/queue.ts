/**
 * Serial GATT operation queue. Web Bluetooth rejects concurrent GATT
 * operations ("GATT operation already in progress"), so every read, write and
 * notification setup goes through here one at a time.
 */

export class QueueTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'QueueTimeoutError';
  }
}

export class QueueClearedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'QueueClearedError';
  }
}

export interface QueueRunOptions {
  /** Per-attempt timeout in ms (default: the queue's timeout). */
  timeoutMs?: number;
  /** Extra attempts after a failure (default 1). A timed-out operation is never retried. */
  retries?: number;
  label?: string;
}

interface Job {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  options: QueueRunOptions;
}

export class GattQueue {
  private readonly jobs: Job[] = [];
  private running = false;
  private generation = 0;

  constructor(
    private readonly defaultTimeoutMs = 5000,
    private readonly defaultRetries = 1,
    private readonly retryDelayMs = 60,
    /**
     * After a timeout the GATT call cannot be cancelled: the queue waits up to
     * this long for it to settle before starting anything else, so two GATT
     * operations never overlap. clear() (link lost) ends the wait early: the
     * browser fails every pending operation of a dropped link.
     */
    private readonly settleGraceMs = 5000,
  ) {}

  /** Ends the current post-timeout wait, if any. */
  private releaseGrace: (() => void) | null = null;
  /** A timed-out operation still running in the browser. */
  private hung: Promise<unknown> | null = null;

  /** Number of operations waiting (not counting the one running). */
  get size(): number {
    return this.jobs.length;
  }

  get busy(): boolean {
    return this.running;
  }

  run<T>(operation: () => Promise<T>, options: QueueRunOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push({ run: operation, resolve: resolve as (value: unknown) => void, reject, options });
      void this.pump();
    });
  }

  /** Rejects every waiting operation (e.g. on disconnect). The running one finishes on its own. */
  clear(reason = 'Queue cleared'): void {
    this.generation++;
    this.releaseGrace?.();
    const pending = this.jobs.splice(0, this.jobs.length);
    for (const job of pending) job.reject(new QueueClearedError(reason));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.jobs.shift();
        if (!job) break;
        const generation = this.generation;
        try {
          job.resolve(await this.attempt(job, generation));
        } catch (error) {
          job.reject(error);
        }
        const hung = this.hung;
        this.hung = null;
        if (hung) {
          // The caller already has its timeout error; the queue stays blocked
          // until the abandoned call settles (bounded, and ended by clear()).
          await new Promise<void>((resolve) => {
            this.releaseGrace = resolve;
            void settled(hung, this.settleGraceMs).then(resolve);
          });
          this.releaseGrace = null;
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async attempt(job: Job, generation: number): Promise<unknown> {
    const retries = job.options.retries ?? this.defaultRetries;
    const timeoutMs = job.options.timeoutMs ?? this.defaultTimeoutMs;
    const label = job.options.label ?? 'GATT operation';
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        if (generation !== this.generation) break; // cleared meanwhile: do not retry
        await delay(this.retryDelayMs);
      }
      let operation: Promise<unknown> | null = null;
      try {
        operation = job.run();
        return await withTimeout(operation, timeoutMs, label);
      } catch (error) {
        lastError = error;
        if (error instanceof QueueTimeoutError && operation) {
          // The call is still running in the browser: never retry it (a write
          // could reach the module twice); pump() waits for it to settle.
          this.hung = operation;
          break;
        }
      }
    }
    throw lastError;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves when `promise` settles (either way) or after `ms`, whichever comes first. */
function settled(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new QueueTimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
