import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('hashPassword', () => {
  it('produces the scrypt:salt:hash format', () => {
    expect(hashPassword('correct horse battery staple')).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it('salts, so the same password never hashes the same way twice', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});

describe('verifyPassword', () => {
  it('accepts the right password', () => {
    const stored = hashPassword('Tr0ubador&3');
    expect(verifyPassword('Tr0ubador&3', stored)).toBe(true);
  });

  it('rejects the wrong password', () => {
    const stored = hashPassword('Tr0ubador&3');
    expect(verifyPassword('Tr0ubador&4', stored)).toBe(false);
  });

  it('is case sensitive', () => {
    expect(verifyPassword('SECRET', hashPassword('secret'))).toBe(false);
  });

  it('handles unicode and long passwords', () => {
    const password = '🔐 contraseña con acentos ñ ' + 'x'.repeat(150);
    expect(verifyPassword(password, hashPassword(password))).toBe(true);
  });

  it('rejects a malformed stored hash rather than throwing', () => {
    for (const stored of ['', 'garbage', 'scrypt:only-two', 'bcrypt:salt:hash', 'scrypt::']) {
      expect(verifyPassword('anything', stored)).toBe(false);
    }
  });

  it('rejects a stored hash of the wrong length without throwing from timingSafeEqual', () => {
    expect(verifyPassword('anything', 'scrypt:aabb:00ff')).toBe(false);
  });
});
