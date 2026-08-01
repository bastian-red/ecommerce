import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { auth } from '../../auth';
import { AdminNav } from '@/components/admin-nav';
import { AdminBar } from '@/components/admin-bar';

/**
 * The admin gate.
 *
 * One check, in the layout, so every page under /admin inherits it and none can
 * be added later that forgets it. It is not the only check: the API's RolesGuard
 * refuses non-admin tokens independently, so this layout is a redirect for the
 * user's benefit, not the security boundary. A UI-only guard is a suggestion.
 *
 * `data-surface="admin"` scopes app/admin.css over this whole subtree: cool
 * slate instead of warm paper, a tighter type scale, denser table rows. An
 * operator who cannot tell at a glance which surface they are on will
 * eventually edit live inventory believing they are browsing.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/admin');
  if (session.user.role !== 'ADMIN') redirect('/');

  return (
    <div data-surface="admin">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AdminBar />
      <main className="container-wide" id="main">
        <AdminNav />
        {children}
      </main>
    </div>
  );
}
