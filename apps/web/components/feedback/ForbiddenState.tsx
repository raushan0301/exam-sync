'use client';

import { ShieldOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { useIdentity } from '@/lib/identity/IdentityProvider';
import { dashboardPathForRole } from '@/lib/navigation';

/** 403 state, built on the same visual family as ErrorState/EmptyState (M1). */
export function ForbiddenState() {
  const router = useRouter();
  const { primaryRole } = useIdentity();

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-24 text-center">
      <ShieldOff className="mb-1 text-danger-text" size={32} aria-hidden="true" />
      <p className="text-lg font-semibold text-text">Access denied</p>
      <p className="max-w-sm text-sm text-text-muted">
        You don&apos;t have permission to view this page.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => router.push(dashboardPathForRole(primaryRole))}
      >
        Return to dashboard
      </Button>
    </div>
  );
}
