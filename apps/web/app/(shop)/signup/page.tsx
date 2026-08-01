import { AuthForm } from '@/components/auth-form';
import { signupAction } from '@/app/auth-actions';

export default function SignupPage() {
  return <AuthForm mode="signup" action={signupAction} />;
}
