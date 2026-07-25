import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

/** Hash a password as `scrypt:<saltHex>:<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

/**
 * Constant-time verification. A plain `===` on the derived key leaks, through
 * timing, how many leading bytes matched, which over enough attempts is enough
 * to reconstruct it.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, salt, KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
