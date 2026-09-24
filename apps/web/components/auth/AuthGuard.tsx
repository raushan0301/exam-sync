'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useIdentity } from '@/lib/identity/IdentityProvider';
import { LoadingState } from '@/components/ui/LoadingState';

/**
 * Client-side route protection. Applied inside each role-segment layout
 * (app/admin/layout.tsx etc), wrapping the RoleGate + shell.
 *
 * - While identity is still loading: shows a loading state (no flash of
 *   protected content, no premature redirect).
 * - Unauthenticated: redirects to /login?redirect=<encoded current path>.
 * - Authenticated but `mustChangePassword`: redirects to /change-password —
 *   this is UX-layer only; the real enforcement is server-side
 *   (JwtAuthGuard blocks every other endpoint with a 403), so skipping this
 *   redirect (e.g. by navigating directly) still can't reach anything.
 * - Authenticated but wrong role: handled by RoleGate (renders Forbidden),
 *   not here — AuthGuard only checks "is anyone logged in at all."
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useIdentity();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const redirect = encodeURIComponent(pathname || '/');
      router.replace(`/login?redirect=${redirect}`);
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && user?.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [isLoading, isAuthenticated, user, pathname, router]);

  if (isLoading) {
    return <LoadingState className="flex min-h-screen items-center justify-center" />;
  }

  if (!isAuthenticated) {
    // Redirect effect above is in flight; render nothing to avoid a flash.
    return <LoadingState className="flex min-h-screen items-center justify-center" />;
  }

  if (user?.mustChangePassword && pathname !== '/change-password') {
    // Redirect effect above is in flight; render nothing to avoid a flash
    // of protected content before it fires.
    return <LoadingState className="flex min-h-screen items-center justify-center" />;
  }

  return <>{children}</>;
}
