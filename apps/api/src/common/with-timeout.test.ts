import { describe, expect, it } from 'vitest';
import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 'fallback', 100)).resolves.toBe('ok');
  });

  it('resolves with the fallback when the promise rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('down')), false, 100)).resolves.toBe(false);
  });

  it('resolves with the fallback when the promise never settles', async () => {
    // The disconnected-Redis case: the command sits in the offline queue forever.
    await expect(withTimeout(new Promise<boolean>(() => {}), false, 20)).resolves.toBe(false);
  });

  it('does not let a late resolution overwrite the fallback', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 60));
    const result = await withTimeout(slow, 'fallback', 10);
    expect(result).toBe('fallback');
    await slow;
    expect(result).toBe('fallback');
  });

  it('returns quickly rather than waiting out the full timeout on success', async () => {
    const started = Date.now();
    await withTimeout(Promise.resolve(true), false, 5_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
