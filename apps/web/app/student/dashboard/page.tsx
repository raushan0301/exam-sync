'use client';

import { CalendarClock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { NotificationsPanel } from '@/components/dashboard/NotificationsPanel';

/**
 * Student dashboard — most constrained of the three roles on the real
 * backend today. GET /users/me returns only the User row id, never the
 * Student-domain-entity id that GET /students/{id}/attendance-history (or
 * any per-student schedule/seat lookup) would require, and there is no
 * GET /exam-sessions list endpoint either. Concretely: there is currently
 * no backend-supported way for a logged-in student to see their own
 * schedule, room/seat assignment, or attendance status.
 *
 * "Recent Notifications" (GET /me/notifications) is the one section with a
 * real, self-scoped data source for this role, so it's the only "live"
 * content here. The schedule panel is an honest EmptyState explaining the
 * gap rather than fabricated sample exam data — this is the correct
 * outcome given the real backend, not a shortcut.
 */
export default function StudentDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">Student Dashboard</h1>

      <Card header={<h2 className="text-sm font-semibold text-text">My Schedule</h2>}>
        <EmptyState
          icon={<CalendarClock size={28} />}
          title="Exam schedule coming soon"
          description="Your upcoming exams, rooms, and seat assignments will appear here once this is available from the backend."
        />
      </Card>

      <NotificationsPanel />
    </div>
  );
}
