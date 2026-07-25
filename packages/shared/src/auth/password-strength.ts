import { z } from 'zod';

/**
 * Password policy shared by the web signup form, its live strength meter, and the
 * API's Zod validation. One definition so the three can never drift apart.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/**
 * A small bundled set of the most-abused passwords. This is deliberately not a
 * full breach corpus — it just blocks the passwords a bot tries first. Stored
 * lowercased; comparison is case-insensitive.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'admin123',
  'letmein123',
  'welcome123',
  'football',
  'monkey123',
  'abc12345',
  'baseball',
  'dragon123',
  'sunshine1',
  'princess1',
  'trustno1',
  'superman1',
  'starwars1',
  'whatever1',
  'changeme1',
  'passw0rd1',
]);

export interface PasswordChecks {
  /** At least PASSWORD_MIN characters (and not over PASSWORD_MAX). */
  length: boolean;
  lowercase: boolean;
  uppercase: boolean;
  digit: boolean;
  /** Not in the common-password set. */
  notCommon: boolean;
}

/** Run every policy check against a candidate password. Pure and deterministic. */
export function passwordChecks(password: string): PasswordChecks {
  return {
    length: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /[0-9]/.test(password),
    notCommon: !COMMON_PASSWORDS.has(password.toLowerCase()),
  };
}

/** True when the password satisfies every check. */
export function isPasswordValid(password: string): boolean {
  return Object.values(passwordChecks(password)).every(Boolean);
}

export interface PasswordScore {
  /** 0 (empty) … 4 (all checks pass). */
  score: 0 | 1 | 2 | 3 | 4;
  label: 'empty' | 'weak' | 'fair' | 'good' | 'strong';
  checks: PasswordChecks;
  valid: boolean;
}

const SCORE_LABELS = ['empty', 'weak', 'fair', 'good', 'strong'] as const;

/**
 * Deterministic strength score for the meter. The score is the number of
 * character-class + length checks passed (0–4); the common-password check gates
 * validity but is folded in by capping a common password below "strong".
 */
export function scorePassword(password: string): PasswordScore {
  if (password.length === 0) {
    return { score: 0, label: 'empty', checks: passwordChecks(password), valid: false };
  }
  const checks = passwordChecks(password);
  const passed = [checks.length, checks.lowercase, checks.uppercase, checks.digit].filter(
    Boolean,
  ).length;
  // A recognized common password can never read as fully "strong".
  let score = passed as 0 | 1 | 2 | 3 | 4;
  if (!checks.notCommon && score > 2) score = 2;
  return { score, label: SCORE_LABELS[score], checks, valid: isPasswordValid(password) };
}

/**
 * The Zod schema used on both sides. superRefine surfaces the first failing rule
 * as a specific, user-facing message instead of a generic "invalid".
 */
export const passwordSchema = z
  .string()
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters.`)
  .superRefine((password, ctx) => {
    const checks = passwordChecks(password);
    if (!checks.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Password must be at least ${PASSWORD_MIN} characters.`,
      });
      return;
    }
    if (!checks.notCommon) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'That password is too common. Choose something less guessable.',
      });
      return;
    }
    if (!checks.lowercase || !checks.uppercase || !checks.digit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password needs an uppercase letter, a lowercase letter, and a number.',
      });
    }
  });
