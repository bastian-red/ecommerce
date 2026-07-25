import { describe, expect, it } from 'vitest';
import { isValidJobId, orderEmailJobId, releaseJobId } from './queue.service';

/**
 * These exist because of a real outage.
 *
 * The job ids originally used ':' as a separator. BullMQ rejects that, because
 * it is BullMQ's own Redis key separator, and `QueueService.enqueue` swallows
 * failures on purpose so a Redis blip cannot roll back a paid order. The result:
 * every order-confirmation email silently never sent, with a full green test
 * suite, and the only evidence was a line in a log nobody was reading.
 *
 * The rule is a pure function now and it is asserted here, so the id can never
 * drift back into an illegal shape.
 */
describe('job ids', () => {
  it('rejects the colon separator BullMQ reserves', () => {
    expect(isValidJobId('release:abc')).toBe(false);
    expect(isValidJobId('ORDER_CONFIRMED:abc')).toBe(false);
  });

  it('accepts the dash-separated form', () => {
    expect(isValidJobId('release-abc')).toBe(true);
  });

  it('rejects an empty id', () => {
    expect(isValidJobId('')).toBe(false);
  });

  it('builds a legal release id for a cuid order id', () => {
    const jobId = releaseJobId('cms0tqwbo000e2o8lmq4b3ymx');
    expect(jobId).toBe('release-cms0tqwbo000e2o8lmq4b3ymx');
    expect(isValidJobId(jobId)).toBe(true);
  });

  it('builds a legal email id for every job kind', () => {
    for (const kind of ['ORDER_CONFIRMED', 'ORDER_FULFILLED', 'ORDER_CANCELLED'] as const) {
      const jobId = orderEmailJobId(kind, 'cms0tqwbo000e2o8lmq4b3ymx');
      expect(isValidJobId(jobId)).toBe(true);
      expect(jobId.startsWith(kind)).toBe(true);
    }
  });

  it('gives one order one email id per kind, so a duplicate webhook sends one email', () => {
    expect(orderEmailJobId('ORDER_CONFIRMED', 'o1')).toBe(
      orderEmailJobId('ORDER_CONFIRMED', 'o1'),
    );
    expect(orderEmailJobId('ORDER_CONFIRMED', 'o1')).not.toBe(
      orderEmailJobId('ORDER_FULFILLED', 'o1'),
    );
  });
});
