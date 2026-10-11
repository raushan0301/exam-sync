'use client';

import Link from 'next/link';
import { Alert } from '@/components/ui';
import type { SuspensionRequest } from '@/lib/queries/types';

const when = (iso: string) => new Date(iso).toLocaleString();

export interface SuspensionStatusBannerProps {
  /** The session's most recent suspension request, if any. */
  request: SuspensionRequest | undefined;
  /** Admins get a link to the review queue; faculty just see the state. */
  isAdmin: boolean;
}

/**
 * Tells whoever is looking at a session what happened to its suspension
 * request — waiting, declined (with the admin's reason), or approved.
 */
export function SuspensionStatusBanner({ request, isAdmin }: SuspensionStatusBannerProps) {
  if (!request) return null;

  if (request.status === 'PENDING') {
    return (
      <Alert color="warning" title="Suspension requested — waiting for admin approval">
        <p>
          {request.facultyName} asked on {when(request.createdAt)} to suspend this session. Reason: {request.reason}
        </p>
        {isAdmin && (
          <p className="mt-1">
            <Link href="/admin/suspension-requests" className="font-medium underline">
              Review the request
            </Link>
          </p>
        )}
      </Alert>
    );
  }

  if (request.status === 'REJECTED') {
    return (
      <Alert color="info" title="The suspension request was declined">
        <p>
          {request.reviewedAt ? `On ${when(request.reviewedAt)}, an` : 'An'} admin declined the request
          {request.reviewNote ? `: ${request.reviewNote}` : '.'} The session stays scheduled.
        </p>
      </Alert>
    );
  }

  return (
    <Alert color="success" title="This session was suspended">
      <p>
        {request.reviewedAt ? `Approved on ${when(request.reviewedAt)}. ` : ''}Its resources were released and it now
        appears under History.
        {request.reviewNote ? ` Admin note: ${request.reviewNote}` : ''}
      </p>
    </Alert>
  );
}
