import { loginSchema, type Role } from '@shop/shared';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { API_BASE_URL } from './lib/config';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        // Credentials are verified by the API, not here. The web app never
        // touches the password hash, so a compromised render process cannot
        // read one.
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(parsed.data),
        });
        if (!response.ok) return null;
        return (await response.json()) as {
          id: string;
          email: string;
          name: string | null;
          role: Role;
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        // The role rides in the session token so admin pages can be gated
        // without a database read on every render.
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
});
