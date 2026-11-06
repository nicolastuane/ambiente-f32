import { describe, expect, it } from 'vitest';
import { GattQueue, QueueClearedError, QueueTimeoutError } from '../src/ble/queue';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('GattQueue', () => {
  it('runs operations one at a time, in order', async () => {
    const queue = new GattQueue(1000, 0);
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    const op = (n: number, ms: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(ms);
      order.push(n);
      running--;
      return n;
    };
    const results = await Promise.all([queue.run(op(1, 15)), queue.run(op(2, 1)), queue.run(op(3, 5))]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(maxRunning).toBe(1);
  });

  it('retries a failed operation once', async () => {
    const queue = new GattQueue(1000, 1, 1);
    let calls = 0;
    const value = await queue.run(async () => {
      calls++;
      if (calls === 1) throw new Error('GATT operation already in progress');
      return 'ok';
    });
    expect(value).toBe('ok');
    expect(calls).toBe(2);
  });

  it('rejects with the last error after the retry', async () => {
    const queue = new GattQueue(1000, 1, 1);
    let calls = 0;
    await expect(
      queue.run(async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      }),
    ).rejects.toThrow('fail 2');
    expect(calls).toBe(2);
  });

  it('times out a hung operation and moves on (after the grace period)', async () => {
    const queue = new GattQueue(20, 0, 1, 30);
    const hung = queue.run(() => new Promise<never>(() => undefined), { label: 'write' });
    const next = queue.run(async () => 'next');
    await expect(hung).rejects.toBeInstanceOf(QueueTimeoutError);
    await expect(next).resolves.toBe('next');
  });

  // Regression: a timed-out GATT call keeps running in the browser. It must
  // not be retried and the next operation must not overlap with it.
  it('never retries a timed-out operation and waits for it to settle', async () => {
    const queue = new GattQueue(20, 3, 1, 5000);
    let calls = 0;
    let running = 0;
    let maxRunning = 0;
    const slow = queue.run(async () => {
      calls++;
      running++;
      maxRunning = Math.max(maxRunning, running);
      await sleep(70);
      running--;
    });
    const next = queue.run(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      running--;
      return 'next';
    });
    await expect(slow).rejects.toBeInstanceOf(QueueTimeoutError);
    await expect(next).resolves.toBe('next');
    expect(calls).toBe(1);
    expect(maxRunning).toBe(1);
  });

  it('clear() (link lost) ends the post-timeout wait', async () => {
    const queue = new GattQueue(20, 0, 1, 60_000);
    const hung = queue.run(() => new Promise<never>(() => undefined));
    await expect(hung).rejects.toBeInstanceOf(QueueTimeoutError);
    queue.clear('Desconectado');
    await expect(queue.run(async () => 'after reconnect')).resolves.toBe('after reconnect');
  });

  it('per-operation options override the defaults', async () => {
    const queue = new GattQueue(5000, 3);
    let calls = 0;
    await expect(
      queue.run(
        async () => {
          calls++;
          await sleep(30);
        },
        { timeoutMs: 5, retries: 0 },
      ),
    ).rejects.toBeInstanceOf(QueueTimeoutError);
    expect(calls).toBe(1);
  });

  it('clear() rejects the waiting operations', async () => {
    const queue = new GattQueue(1000, 0);
    const first = queue.run(() => sleep(20).then(() => 'first'));
    const second = queue.run(async () => 'second');
    const third = queue.run(async () => 'third');
    expect(queue.size).toBe(2);
    queue.clear('Desconectado');
    await expect(second).rejects.toBeInstanceOf(QueueClearedError);
    await expect(third).rejects.toBeInstanceOf(QueueClearedError);
    await expect(first).resolves.toBe('first');
    expect(queue.size).toBe(0);
    await expect(queue.run(async () => 'after')).resolves.toBe('after');
  });
});
