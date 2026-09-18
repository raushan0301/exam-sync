'use client';

import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/ErrorState';

export function SessionExpiredState() {
  const router = useRouter();
  return (
    <ErrorState
      title="Session expired"
      description="Please sign in again to continue."
      onRetry={() => router.push('/login')}
    />
  );
}
