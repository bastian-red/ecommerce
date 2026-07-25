'use client';

import { scorePassword } from '@shop/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import type { AuthState } from '../app/auth-actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" type="submit" disabled={pending} style={{ width: '100%' }}>
      {pending ? 'Please wait…' : label}
    </button>
  );
}

/**
 * The meter is driven by `scorePassword` from @shop/shared, which is the same
 * function the API's Zod schema enforces with. One policy, so the meter can
 * never say "strong" about a password the server then rejects.
 */
function StrengthMeter({ password }: { password: string }) {
  const { score, label, valid } = useMemo(() => scorePassword(password), [password]);
  return (
    <div className="strength" aria-live="polite">
      <div className="strength-bars">
        {[1, 2, 3, 4].map((segment) => (
          <span key={segment} className={`strength-seg${segment <= score ? ' on' : ''}`} />
        ))}
      </div>
      <span className="strength-label mono">
        {password.length === 0
          ? 'PASSWORD STRENGTH'
          : `${label.toUpperCase()}${valid ? '' : ' · needs 10+ chars, A-z, 0-9'}`}
      </span>
    </div>
  );
}

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: 'login' | 'signup';
  action: (state: AuthState | undefined, formData: FormData) => Promise<AuthState>;
  next?: string;
}) {
  const [state, formAction] = useFormState(action, undefined);
  const [password, setPassword] = useState('');
  const [renderedAt] = useState(() => Date.now());
  const isSignup = mode === 'signup';

  return (
    <div className="auth-wrap">
      <div className="card">
        <h2 className="center">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
        <form action={formAction}>
          {next && <input type="hidden" name="next" value={next} />}
          {isSignup && (
            <>
              <label htmlFor="name">Name</label>
              <input id="name" name="name" required autoComplete="name" data-testid="name" />
              <input type="hidden" name="_ts" value={renderedAt} />
              {/* Honeypot: off-screen for humans, tempting to a form-filling bot. */}
              <div className="hp" aria-hidden="true">
                <label htmlFor="company">Company</label>
                <input id="company" name="company" type="text" tabIndex={-1} autoComplete="off" />
              </div>
            </>
          )}
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" data-testid="email" />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            onChange={isSignup ? (event) => setPassword(event.target.value) : undefined}
            data-testid="password"
          />
          {isSignup && <StrengthMeter password={password} />}
          <div style={{ marginTop: 16 }}>
            <SubmitButton label={isSignup ? 'Sign up' : 'Log in'} />
          </div>
          {state?.error && (
            <p className="error" role="alert" data-testid="auth-error">
              {state.error}
            </p>
          )}
        </form>
        <p className="center muted" style={{ marginTop: 16 }}>
          {isSignup ? (
            <>
              Already have an account? <Link href="/login">Log in</Link>
            </>
          ) : (
            <>
              New here? <Link href="/signup">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
