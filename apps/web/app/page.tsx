'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIdentity } from '@/lib/identity/IdentityProvider';
import { dashboardPathForRole } from '@/lib/navigation';

/**
 * Root "/" — never a real destination, just a dispatcher: signed-in users
 * go straight to their role's dashboard, everyone else to `/login`. Landing
 * here previously showed a static Phase-0 placeholder with no links at
 * all, so a user hitting `http://localhost:3001` directly had nothing to
 * click and no way to reach the rest of the app.
 */
export default function HomePage() {
  const router = useRouter();
  const { isLoading, isAuthenticated, primaryRole } = useIdentity();

  useEffect(() => {
    if (isLoading) return;
    router.replace(isAuthenticated ? dashboardPathForRole(primaryRole) : '/login');
  }, [isLoading, isAuthenticated, primaryRole, router]);

  return null;
}
