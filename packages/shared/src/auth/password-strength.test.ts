import { describe, expect, it } from 'vitest';
import {
  isPasswordValid,
  passwordSchema,
  scorePassword,
  PASSWORD_MIN,
} from './password-strength';

describe('passwordSchema', () => {
  const valid = 'Str0ngPass!';

  it('accepts a password with length, upper, lower, and a digit', () => {
    expect(passwordSchema.safeParse(valid).success).toBe(true);
    expect(isPasswordValid(valid)).toBe(true);
  });

  it.each([
    ['too short', 'Ab1cdef', 'at least'],
    ['no uppercase', 'str0ngpass!', 'uppercase'],
    ['no lowercase', 'STR0NGPASS!', 'uppercase'],
    ['no digit', 'StrongPassword', 'number'],
    ['common password', 'password123', 'too common'],
  ])('rejects %s', (_label, pw, fragment) => {
    const result = passwordSchema.safeParse(pw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message.toLowerCase()).toContain(fragment);
    }
    expect(isPasswordValid(pw)).toBe(false);
  });

  it('reports the length rule before the character-class rule', () => {
    const result = passwordSchema.safeParse('Ab1'); // short AND missing classes
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].message).toContain(String(PASSWORD_MIN));
    }
  });
});

describe('scorePassword', () => {
  it('scores an empty password as 0/empty', () => {
    const s = scorePassword('');
    expect(s.score).toBe(0);
    expect(s.label).toBe('empty');
    expect(s.valid).toBe(false);
  });

  it('scores a full-strength password as 4/strong and valid', () => {
    const s = scorePassword('Str0ngPass!');
    expect(s.score).toBe(4);
    expect(s.label).toBe('strong');
    expect(s.valid).toBe(true);
  });

  it('caps a recognized common password below strong even if long and mixed', () => {
    const s = scorePassword('Password123'); // long, mixed classes, but common
    expect(s.checks.notCommon).toBe(false);
    expect(s.score).toBeLessThanOrEqual(2);
    expect(s.valid).toBe(false);
  });

  it('increases monotonically as length then classes are added', () => {
    expect(scorePassword('aaaaaaaaa').score).toBe(1); // 9 chars: lowercase only, length fails
    expect(scorePassword('aaaaaaaaaa').score).toBe(2); // 10 chars: + length
    expect(scorePassword('aaaaaaaaaA').score).toBe(3); // + uppercase
    expect(scorePassword('aaaaaaaaA1').score).toBe(4); // + digit
  });
});
