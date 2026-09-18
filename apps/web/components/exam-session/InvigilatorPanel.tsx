'use client';

import { useState } from 'react';
import { Alert, Button, EmptyState, Modal, Select } from '@/components/ui';
import { useFaculty } from '@/lib/queries/useFaculty';
import { useAssignInvigilator } from '@/lib/mutations/useInvigilationMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, Invigilator, InvigilatorRole } from '@/lib/queries/types';

const ROLE_OPTIONS: { value: InvigilatorRole; label: string }[] = [
  { value: 'LEAD_INVIGILATOR', label: 'Lead Invigilator' },
  { value: 'ASSISTANT_INVIGILATOR', label: 'Assistant Invigilator' },
];

export interface InvigilatorPanelProps {
  session: ExamSessionDetail;
}

/**
 * ADMIN "Invigilators" panel — assigns a faculty member to a room+role via
 * `POST /exam-sessions/{id}/invigilators`. There is deliberately NO
 * `GET /exam-sessions/{id}/invigilators` (or any session-scoped list)
 * endpoint on the real backend — `InvigilationController` exposes exactly
 * `assign` and `GET /faculty/{id}/invigilation-duties` (faculty-scoped,
 * not session-scoped) — so, same posture as `SeatingPanel`'s per-room
 * planId tracking, "current assignments" here is a session-local list
 * built from this panel's own successful `assign` calls, not fetched from
 * a persisted list. A page reload loses this local list (nothing is lost
 * server-side — the assignment still exists — it just can't be
 * re-displayed here without a list endpoint); this is disclosed in the
 * empty state's copy rather than silently presented as complete data.
 */
export function InvigilatorPanel({ session }: InvigilatorPanelProps) {
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [role, setRole] = useState<InvigilatorRole>('LEAD_INVIGILATOR');
  const [assigned, setAssigned] = useState<Invigilator[]>([]);

  const facultyQuery = useFaculty({ limit: 200, status: 'ACTIVE' });
  const assignMutation = useAssignInvigilator(session.id);

  const facultyById = new Map((facultyQuery.data?.items ?? []).map((f) => [f.id, f]));
  const roomById = new Map(session.rooms.map((r) => [r.id, r]));

  async function onAssign() {
    try {
      const result = await assignMutation.mutateAsync({ room_id: roomId, faculty_id: facultyId, role });
      setAssigned((prev) => [...prev, result]);
      setOpen(false);
      setRoomId('');
      setFacultyId('');
      setRole('LEAD_INVIGILATOR');
    } catch {
      // surfaced below via assignMutation.error, keep the modal open
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)} disabled={session.rooms.length === 0}>
          Assign Invigilator
        </Button>
      </div>

      {assigned.length === 0 ? (
        <EmptyState
          title="No invigilators assigned yet"
          description="Assignments made in this session appear here. (There is no server-side list endpoint for this yet — reloading the page will clear this local list, though the assignments themselves remain saved.)"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {assigned.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
              <span className="text-text">
                {facultyById.get(inv.facultyId)?.name ?? inv.facultyId} — {roomById.get(inv.roomId)?.roomNumber ?? inv.roomId}
              </span>
              <span className="text-text-muted">{ROLE_OPTIONS.find((r) => r.value === inv.role)?.label}</span>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) assignMutation.reset();
        }}
        title="Assign Invigilator"
        description="Assign a faculty member to invigilate a specific room for this session."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={assignMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={onAssign} loading={assignMutation.isPending} disabled={!roomId || !facultyId}>
              Assign
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {assignMutation.isError && (
            <Alert color="danger" title="Couldn't assign invigilator">
              <div className="flex flex-col gap-1">
                <span>{mapError(assignMutation.error).description}</span>
              </div>
            </Alert>
          )}

          <Select
            label="Room"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            options={[
              { value: '', label: 'Select a room…' },
              ...session.rooms.map((r) => ({ value: r.id, label: `${r.building} · Room ${r.roomNumber}` })),
            ]}
          />
          <Select
            label="Faculty"
            value={facultyId}
            onChange={(e) => setFacultyId(e.target.value)}
            options={[
              { value: '', label: 'Select a faculty member…' },
              ...(facultyQuery.data?.items ?? []).map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as InvigilatorRole)}
            options={ROLE_OPTIONS}
          />
        </div>
      </Modal>
    </div>
  );
}
