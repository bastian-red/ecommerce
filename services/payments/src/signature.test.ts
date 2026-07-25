import { describe, expect, it } from 'vitest';
import { DEFAULT_TOLERANCE_SECONDS, signPayload, verifySignature } from './signature';
import { WebhookSignatureError } from './types';

// Long enough to be a realistic HMAC key, and obviously not a real one.
const SECRET = 'fixture-value-not-a-secret-000000000';
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });

describe('signPayload / verifySignature', () => {
  it('accepts a signature it just produced', () => {
    const header = signPayload(BODY, SECRET, NOW);
    expect(() => verifySignature(BODY, header, SECRET, DEFAULT_TOLERANCE_SECONDS, NOW)).not.toThrow();
  });

  it('emits the documented header format', () => {
    expect(signPayload(BODY, SECRET, NOW)).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
  });

  it('accepts a Buffer body identically to a string body', () => {
    const header = signPayload(BODY, SECRET, NOW);
    expect(() =>
      verifySignature(Buffer.from(BODY, 'utf8'), header, SECRET, DEFAULT_TOLERANCE_SECONDS, NOW),
    ).not.toThrow();
  });

  it('rejects a tampered body', () => {
    const header = signPayload(BODY, SECRET, NOW);
    const tampered = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', x: 1 });
    expect(() => verifySignature(tampered, header, SECRET, DEFAULT_TOLERANCE_SECONDS, NOW)).toThrow(
      WebhookSignatureError,
    );
  });

  it('rejects the wrong secret', () => {
    const header = signPayload(BODY, SECRET, NOW);
    expect(() =>
      verifySignature(BODY, header, 'fixture-value-different-key-000000000', DEFAULT_TOLERANCE_SECONDS, NOW),
    ).toThrow(WebhookSignatureError);
  });

  it('rejects a replay outside the tolerance window', () => {
    const header = signPayload(BODY, SECRET, NOW);
    const late = NOW + DEFAULT_TOLERANCE_SECONDS + 1;
    expect(() => verifySignature(BODY, header, SECRET, DEFAULT_TOLERANCE_SECONDS, late)).toThrow(
      /outside tolerance/,
    );
  });

  it('accepts a replay exactly on the tolerance boundary', () => {
    const header = signPayload(BODY, SECRET, NOW);
    const edge = NOW + DEFAULT_TOLERANCE_SECONDS;
    expect(() => verifySignature(BODY, header, SECRET, DEFAULT_TOLERANCE_SECONDS, edge)).not.toThrow();
  });

  it('rejects a timestamp too far in the future', () => {
    const header = signPayload(BODY, SECRET, NOW + 10_000);
    expect(() => verifySignature(BODY, header, SECRET, DEFAULT_TOLERANCE_SECONDS, NOW)).toThrow(
      /outside tolerance/,
    );
  });

  it('rejects a moved timestamp, because the timestamp is inside the MAC', () => {
    const header = signPayload(BODY, SECRET, NOW);
    const shifted = header.replace(`t=${NOW}`, `t=${NOW + 1}`);
    expect(() => verifySignature(BODY, shifted, SECRET, DEFAULT_TOLERANCE_SECONDS, NOW)).toThrow(
      /mismatch/,
    );
  });

  it('rejects a malformed header', () => {
    for (const header of ['', 'garbage', 't=123', 'v1=abc', 't=notanumber,v1=abc']) {
      expect(() => verifySignature(BODY, header, SECRET, DEFAULT_TOLERANCE_SECONDS, NOW)).toThrow(
        WebhookSignatureError,
      );
    }
  });

  it('rejects when no secret is configured', () => {
    const header = signPayload(BODY, SECRET, NOW);
    expect(() => verifySignature(BODY, header, '', DEFAULT_TOLERANCE_SECONDS, NOW)).toThrow(
      /No signing secret/,
    );
  });

  it('accepts when any one of several v1 values matches, for secret rotation', () => {
    const good = signPayload(BODY, SECRET, NOW).split('v1=')[1];
    const header = `t=${NOW},v1=${'0'.repeat(64)},v1=${good}`;
    expect(() => verifySignature(BODY, header, SECRET, DEFAULT_TOLERANCE_SECONDS, NOW)).not.toThrow();
  });

  it('rejects a MAC of the wrong length without throwing from timingSafeEqual', () => {
    const header = `t=${NOW},v1=abc`;
    expect(() => verifySignature(BODY, header, SECRET, DEFAULT_TOLERANCE_SECONDS, NOW)).toThrow(
      /mismatch/,
    );
  });
});
