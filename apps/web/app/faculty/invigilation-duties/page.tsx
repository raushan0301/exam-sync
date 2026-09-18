'use client';

import { ClipboardList } from 'lucide-react';
import { Card, EmptyState } from '@/components/ui';

/**
 * FACULTY "My Invigilation Duties" — GET /faculty/{id}/invigilation-duties
 * is genuinely self-scoped server-side (`InvigilationService.listDuties`
 * resolves "is this really you" via `facultyService.findByUserId`), but
 * the URL still requires the caller's Faculty-row id as a path param, and
 * `GET /users/me` (the only self-identity endpoint on this backend)
 * returns exactly `{id, email, isActive, roles, createdAt}` — no
 * `facultyId`. This is the SAME gap `app/faculty/dashboard/page.tsx`
 * already documented in M3 for "My Assignments"/"My Invigilation Duties"
 * (no general self-ID-resolution capability exists), confirmed still true
 * for this specific endpoint by reading its controller/service directly.
 * Per that milestone's precedent, this is handled with an honest note
 * rather than an invented workaround (e.g. guessing a faculty id, or
 * scanning every faculty row client-side, which would be both wrong and
 * a privacy leak).
 */
export default function FacultyInvigilationDutiesPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">My Invigilation Duties</h1>
      <Card>
        <EmptyState
          icon={<ClipboardList size={28} />}
          title="Not available yet"
          description="This list requires resolving your own faculty record, which the backend does not yet expose to a logged-in user (GET /users/me returns no faculty id). An administrator can tell you which sessions and rooms you're assigned to invigilate in the meantime."
        />
      </Card>
    </div>
  );
}
