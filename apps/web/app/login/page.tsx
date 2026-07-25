import { AuthForm } from '../../components/auth-form';
import { loginAction } from '../auth-actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  // Only a same-site path is honoured. An absolute URL here would make the login
  // page an open redirect, which is how a phishing link gets a real domain.
  const target = typeof next === 'string' && next.startsWith('/') ? next : undefined;
  return <AuthForm mode="login" action={loginAction} next={target} />;
}
