'use client';

import { useState } from 'react';
import { Alert, Button, ConfirmationDialog, EmptyState, ErrorState, Modal, Select, SkeletonText } from '@/components/ui';
import { useFaculty } from '@/lib/queries/useFaculty';
import { useSessionInvigilators } from '@/lib/queries/useInvigilationDuties';
import { useAssignInvigilator, useRemoveInvigilator } from '@/lib/mutations/useInvigilationMutations';
import { mapError } from '@/lib/error-mapping';
import type { ExamSessionDetail, Invigilator, InvigilatorRole } from '@/lib/queries/types';

const ROLE_OPTIONS: { value: InvigilatorRole; label: string }[] = [
  { value: 'LEAD_INVIGILATOR', label: 'Lead Invigilator' },
  { value: 'ASSISTANT_INVIGILATOR', label: 'Assistant Invigilator' },
];

export interface InvigilatorPanelProps {
  session: ExamSessionDetail;
  /** Faculty-lifecycle-ownership change: ADMIN is now read-only for scheduling data — pass `true` to hide the Assign Invigilator action entirely. */
  readOnly?: boolean;
}

/**
 * "Invigilators" panel — assigns a faculty member to a room+role via
 * `POST /exam-sessions/{id}/invigilators`, and lists current assignments
 * via `GET /exam-sessions/{id}/invigilators` (ADMIN unscoped / owning
 * FACULTY scoped) — a persisted, reload-safe list, not local component
 * state.
 */
export function InvigilatorPanel({ session, readOnly = false }: InvigilatorPanelProps) {
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [role, setRole] = useState<InvigilatorRole>('LEAD_INVIGILATOR');
  const [removing, setRemoving] = useState<Invigilator | null>(null);

  const facultyQuery = useFaculty({ all: true, status: 'ACTIVE' });
  const invigilatorsQuery = useSessionInvigilators(session.id, { all: true });
  const assignMutation = useAssignInvigilator(session.id);
  const removeMutation = useRemoveInvigilator(session.id);

  const facultyById = new Map((facultyQuery.data?.items ?? []).map((f) => [f.id, f]));
  const roomById = new Map(session.rooms.map((r) => [r.id, r]));

  // A faculty member can't invigilate two rooms in the same session
  // (BR-031, faculty double-booking) — hide anyone already assigned here
  // from the picker instead of letting the admin/faculty pick them and
  // hit a 409; removing their assignment (below) makes them selectable
  // again automatically, since this just re-derives from the live list.
  const alreadyAssignedFacultyIds = new Set((invigilatorsQuery.data?.items ?? []).map((inv) => inv.facultyId));
  const assignableFaculty = (facultyQuery.data?.items ?? []).filter((f) => !alreadyAssignedFacultyIds.has(f.id));

  async function onAssign() {
    try {
      await assignMutation.mutateAsync({ room_id: roomId, faculty_id: facultyId, role });
      setOpen(false);
      setRoomId('');
      setFacultyId('');
      setRole('LEAD_INVIGILATOR');
    } catch {
      // surfaced below via assignMutation.error, keep the modal open
    }
  }

  async function onConfirmRemove() {
    if (!removing) return;
    try {
      await removeMutation.mutateAsync(removing.id);
      setRemoving(null);
    } catch {
      // surfaced below via removeMutation.error, keep the dialog open
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!readOnly && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)} disabled={session.rooms.length === 0}>
            Assign Invigilator
          </Button>
        </div>
      )}

      {invigilatorsQuery.isLoading ? (
        <SkeletonText lines={3} />
      ) : invigilatorsQuery.isError ? (
        <ErrorState
          title="Couldn't load invigilators"
          description={mapError(invigilatorsQuery.error).description}
          onRetry={() => invigilatorsQuery.refetch()}
        />
      ) : (invigilatorsQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title="No invigilators assigned yet"
          description="Assignments made for this session appear here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {invigilatorsQuery.data!.items.map((inv) => (
            <li key={inv.id} className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2 text-sm">
              <span className="text-text">
                {facultyById.get(inv.facultyId)?.name ?? inv.facultyId} — {roomById.get(inv.roomId)?.roomNumber ?? inv.roomId}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-text-muted">{ROLE_OPTIONS.find((r) => r.value === inv.role)?.label}</span>
                {!readOnly && (
                  <Button size="sm" variant="tertiary" onClick={() => setRemoving(inv)}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {removeMutation.isError && (
        <Alert color="danger" title="Couldn't remove invigilator">
          {mapError(removeMutation.error).description}
        </Alert>
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
              ...assignableFaculty.map((f) => ({ value: f.id, label: f.name })),
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

      <ConfirmationDialog
        open={!!removing}
        onOpenChange={(next) => {
          if (!next) {
            setRemoving(null);
            removeMutation.reset();
          }
        }}
        title="Remove invigilator?"
        description={
          removing
            ? `"${facultyById.get(removing.facultyId)?.name ?? removing.facultyId}" will no longer be assigned to invigilate ${roomById.get(removing.roomId)?.roomNumber ?? 'this room'}. You can assign a different faculty member afterward.`
            : ''
        }
        confirmLabel="Remove"
        loading={removeMutation.isPending}
        onConfirm={onConfirmRemove}
      />
    </div>
  );
}
