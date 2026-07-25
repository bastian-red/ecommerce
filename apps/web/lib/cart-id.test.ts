import { describe, expect, it } from 'vitest';
import { createSignedCartId, readSignedCartId } from './cart-id';

const SECRET = 'a-test-auth-secret-at-least-16-chars';

describe('createSignedCartId', () => {
  it('mints an id the API will accept', () => {
    const { id } = createSignedCartId(SECRET);
    // Same pattern the API's CartController enforces.
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createSignedCartId(SECRET).id));
    expect(ids.size).toBe(200);
  });

  it('produces a cookie value of id.mac', () => {
    const { id, cookieValue } = createSignedCartId(SECRET);
    expect(cookieValue.startsWith(`${id}.`)).toBe(true);
  });
});

describe('readSignedCartId', () => {
  it('round-trips a value it minted', () => {
    const { id, cookieValue } = createSignedCartId(SECRET);
    expect(readSignedCartId(cookieValue, SECRET)).toBe(id);
  });

  it('rejects a client-forged id, so Redis only ever holds ids we minted', () => {
    expect(readSignedCartId('attacker-chosen-id.whatever', SECRET)).toBeNull();
  });

  it('rejects a value signed with a different secret', () => {
    const { cookieValue } = createSignedCartId('a-completely-different-secret-value');
    expect(readSignedCartId(cookieValue, SECRET)).toBeNull();
  });

  it('rejects a tampered id with a valid-looking mac', () => {
    const { id, cookieValue } = createSignedCartId(SECRET);
    const mac = cookieValue.slice(id.length + 1);
    const otherId = createSignedCartId(SECRET).id;
    expect(readSignedCartId(`${otherId}.${mac}`, SECRET)).toBeNull();
  });

  it('rejects missing, empty and malformed values', () => {
    for (const value of [undefined, '', 'nodot', '.macOnly', 'id-with-no-mac.']) {
      expect(readSignedCartId(value, SECRET)).toBeNull();
    }
  });

  it('rejects an id that fails the API pattern even when correctly signed', () => {
    // Nothing should be able to smuggle a colon or a slash into a Redis key.
    const bad = 'cart:*';
    const signed = createSignedCartId(SECRET);
    expect(readSignedCartId(`${bad}.${signed.cookieValue.split('.')[1]}`, SECRET)).toBeNull();
  });

  it('rejects a mac of the wrong length without throwing', () => {
    const { id } = createSignedCartId(SECRET);
    expect(readSignedCartId(`${id}.short`, SECRET)).toBeNull();
  });
});
