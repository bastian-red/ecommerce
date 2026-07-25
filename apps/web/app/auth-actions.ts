'use server';

import { signupSchema } from '@shop/shared';
import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '../auth';
import { API_BASE_URL } from '../lib/config';

export interface AuthState {
  error?: string;
}

/** Minimum seconds a human takes to fill the signup form. Bots submit instantly. */
const MIN_FILL_SECONDS = 2;

export async function loginAction(_state: AuthState | undefined, formData: FormData): Promise<AuthState> {
  const next = String(formData.get('next') ?? '/');
  try {
    await signIn('credentials', {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) return { error: 'Invalid email or password.' };
    throw error;
  }
  // Outside the try: redirect() signals by throwing, and catching it here would
  // leave the user on a form that appeared to do nothing.
  redirect(next.startsWith('/') ? next : '/');
}

export async function signupAction(_state: AuthState | undefined, formData: FormData): Promise<AuthState> {
  // Honeypot: a field hidden from humans and irresistible to naive bots.
  if (String(formData.get('company') ?? '') !== '') return { error: 'Signup failed.' };
  const renderedAt = Number(formData.get('_ts') ?? 0);
  if (renderedAt && (Date.now() - renderedAt) / 1000 < MIN_FILL_SECONDS) {
    return { error: 'That was too quick. Please try again.' };
  }

  const parsed = signupSchema.safeParse({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    name: String(formData.get('name') ?? ''),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Please check the form.' };
  }

  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return { error: body.message ?? 'Could not create that account.' };
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch {
    // The account exists; only the auto sign-in failed. Sending them to the
    // login page is better than reporting a failure that did not happen.
    redirect('/login');
  }
  redirect('/');
}
