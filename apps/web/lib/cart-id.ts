import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Cart identity.
 *
 * A cart id is a bearer capability: whoever holds it sees that cart. So it is
 * 24 random bytes (192 bits), which is not guessable, and it is HMAC-signed with
 * AUTH_SECRET before it goes into a cookie.
 *
 * The signature is not about secrecy, it is about the keyspace. Without it a
 * client could set any cookie value it liked and the API would happily create a
 * Redis key for it, which is an unbounded write primitive against our cache.
 * With it, the only cart ids that ever reach Redis are ones this server minted.
 *
 * Cookie format: `<id>.<mac>`. The API only ever sees `<id>`, and validates it
 * against `/^[A-Za-z0-9_-]{16,64}$/`, which base64url of 24 bytes satisfies.
 */
export const CART_COOKIE = 'cart_id';

/** 30 days, matching the cart's Redis TTL. */
export const CART_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function macFor(id: string, secret: string): string {
  return createHmac('sha256', secret).update(id).digest('base64url');
}

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set');
  return secret;
}

/** Mint a fresh signed cart id. */
export function createSignedCartId(secret: string = requireSecret()): {
  id: string;
  cookieValue: string;
} {
  const id = randomBytes(24).toString('base64url');
  return { id, cookieValue: `${id}.${macFor(id, secret)}` };
}

/**
 * Recover the id from a cookie value, or null if it was not minted by us.
 * Comparison is constant-time, for the same reason every other MAC comparison
 * in this repo is.
 */
export function readSignedCartId(
  cookieValue: string | undefined,
  secret: string = requireSecret(),
): string | null {
  if (!cookieValue) return null;
  const separator = cookieValue.lastIndexOf('.');
  if (separator <= 0) return null;

  const id = cookieValue.slice(0, separator);
  const mac = cookieValue.slice(separator + 1);
  if (!ID_PATTERN.test(id)) return null;

  const expected = macFor(id, secret);
  const provided = Buffer.from(mac, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (provided.length !== wanted.length) return null;
  return timingSafeEqual(provided, wanted) ? id : null;
}
