'use client';

import { useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { Textarea, FormField, Button, Alert, Select, SkeletonText } from '@/components/ui';
import { cn } from '@/components/ui/utils';
import { SeatMap } from '@/components/seating/SeatMap';
import { useMyFaculty } from '@/lib/queries/useFaculty';
import { useInvigilationDuties } from '@/lib/queries/useInvigilationDuties';
import { useRoomSeats } from '@/lib/queries/useRoomSeats';
import { useSeatingPlan } from '@/lib/queries/useSeatingPlan';
import { apiFetch } from '@/lib/api-client';
import { mapError } from '@/lib/error-mapping';
import type { IncidentSeverity, IncidentType, InvigilatorDuty, SeatingAssignment, SeatingGenerationSummary } from '@/lib/queries/types';

const INCIDENT_TYPE_OPTIONS: { value: IncidentType; label: string }[] = [
  { value: 'CHEATING_SUSPICION', label: 'Suspected Cheating' },
  { value: 'UNAUTHORIZED_MATERIAL', label: 'Unauthorized Material' },
  { value: 'MISCONDUCT', label: 'Misconduct' },
  { value: 'MISSING', label: 'Student Missing' },
  { value: 'LATE', label: 'Late Arrival' },
  { value: 'MEDICAL', label: 'Medical Issue' },
  { value: 'SEATING', label: 'Seating Issue' },
  { value: 'TECHNICAL', label: 'Technical Issue' },
  { value: 'ROOM', label: 'Room Issue' },
  { value: 'IDENTITY', label: 'Identity Verification' },
  { value: 'PAPER', label: 'Question Paper Issue' },
  { value: 'OTHER', label: 'Other' },
];

const SEVERITY_OPTIONS: { value: IncidentSeverity; label: string; classes: string }[] = [
  { value: 'LOW', label: 'Low', classes: 'border-statusneutral-border bg-statusneutral-bg text-statusneutral-text' },
  { value: 'MEDIUM', label: 'Medium', classes: 'border-warning-border bg-warning-bg text-warning-text' },
  { value: 'HIGH', label: 'High', classes: 'border-danger-border bg-danger-bg text-danger-text' },
  { value: 'CRITICAL', label: 'Critical', classes: 'border-danger-border bg-danger-text text-white' },
];

const optionalUuid = z
  .string()
  .optional()
  .refine((v) => !v || z.string().uuid().safeParse(v).success, 'Must be a valid UUID.');

export const incidentFormSchema = z.object({
  exam_session_id: z.string().uuid('Select the exam session you are invigilating.'),
  incident_type: z.enum(
    INCIDENT_TYPE_OPTIONS.map((o) => o.value) as [IncidentType, ...IncidentType[]],
    { required_error: 'Select an incident type.' },
  ),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], { required_error: 'Select a severity.' }),
  description: z.string().min(1, 'Description is required.'),
  quiz_id: optionalUuid,
  student_id: optionalUuid,
  room_id: optionalUuid,
  seat_id: optionalUuid,
});

export type IncidentFormValues = z.infer<typeof incidentFormSchema>;

export function defaultIncidentFormValues(): IncidentFormValues {
  return {
    exam_session_id: '',
    incident_type: undefined as unknown as IncidentType,
    severity: undefined as unknown as IncidentSeverity,
    description: '',
    quiz_id: '',
    student_id: '',
    room_id: '',
    seat_id: '',
  };
}

export function toIncidentApiPayload(values: IncidentFormValues) {
  return {
    exam_session_id: values.exam_session_id,
    incident_type: values.incident_type,
    severity: values.severity,
    description: values.description,
    quiz_id: values.quiz_id || undefined,
    student_id: values.student_id || undefined,
    room_id: values.room_id || undefined,
    seat_id: values.seat_id || undefined,
  };
}

export interface IncidentFormProps {
  form: ReturnType<typeof useForm<IncidentFormValues>>;
  onSubmit: (values: IncidentFormValues) => void | Promise<void>;
  submitLabel: string;
  submitting?: boolean;
  rootError?: string;
}

function dutyLabel(duty: InvigilatorDuty): string {
  const date = duty.examSession.sessionDate.slice(0, 10);
  return `${duty.examSession.name} · ${duty.room.building} ${duty.room.roomNumber} · ${date}`;
}

/**
 * Seat/student picker for a chosen invigilation duty. Recovers the room's
 * seating-plan id the same way `SeatingPanel.tsx`'s `RoomSeatingCard` does
 * (idempotent generate call, EC-032) — by this point in an exam's lifecycle
 * (the faculty is actively invigilating it) seating generation is long past,
 * so this can only ever recover an existing plan, never create one.
 */
function IncidentSeatPicker({
  duty,
  selectedSeatId,
  onPick,
  onClear,
}: {
  duty: InvigilatorDuty;
  selectedSeatId: string | undefined;
  onPick: (assignment: SeatingAssignment) => void;
  onClear: () => void;
}) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const planQuery = useSeatingPlan(planId ?? undefined);
  const seatsQuery = useRoomSeats(planId ? duty.roomId : undefined);

  async function loadSeatMap() {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await apiFetch<SeatingGenerationSummary>(`/exam-sessions/${duty.examSessionId}/seating/generate`, {
        method: 'POST',
        body: { room_id: duty.roomId, strategy: 'SEQUENTIAL' },
      });
      setPlanId(result.seating_plan_id);
    } catch (err) {
      setLoadError(mapError(err).description);
    } finally {
      setLoading(false);
    }
  }

  if (!planId) {
    return (
      <div className="flex flex-col gap-2">
        {loadError && <Alert color="danger" title="Couldn't load the seat map">{loadError}</Alert>}
        <Button type="button" variant="secondary" size="sm" loading={loading} onClick={loadSeatMap}>
          Load Seat Map
        </Button>
      </div>
    );
  }

  if (planQuery.isLoading || seatsQuery.isLoading) {
    return <SkeletonText lines={4} />;
  }

  if (planQuery.isError) {
    return (
      <Alert color="danger" title="Couldn't load the seating plan">
        {mapError(planQuery.error).description}
      </Alert>
    );
  }

  if (!planQuery.data) return null;

  return (
    <div className="flex flex-col gap-2">
      <SeatMap
        seats={seatsQuery.data ?? []}
        assignments={planQuery.data.assignments}
        coloring="incident"
        selectedSeatId={selectedSeatId}
        onIncidentSeatClick={onPick}
      />
      {selectedSeatId && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={onClear}>
            Clear seat selection
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * FACULTY incident-report form matching CreateIncidentDto. `exam_session_id`
 * (and, alongside it, `room_id`) is picked from the faculty's own
 * invigilation duties (`GET /faculty/{id}/invigilation-duties`) rather than
 * typed as a raw UUID — resolved via `useMyFaculty` (`GET /faculty/me`) the
 * same way `app/faculty/invigilation-duties/page.tsx` does, since `GET
 * /users/me` never exposes a faculty id directly. The backend still
 * independently 403s (BR-037) if the caller isn't actually on that session's
 * invigilator roster, so this is a convenience picker, not the authorization
 * check itself.
 *
 * `student_id`/`seat_id`/`quiz_id` are filled by picking a seat on that
 * room's live seat map (`IncidentSeatPicker`) instead of typing ids by hand —
 * "report an unfair thing about a specific student" now means clicking their
 * seat, not knowing their UUID.
 */
export function IncidentForm({ form, onSubmit, submitLabel, submitting, rootError }: IncidentFormProps) {
  const myFacultyQuery = useMyFaculty();
  const dutiesQuery = useInvigilationDuties(myFacultyQuery.data?.id, { all: true });
  const [selectedDutyId, setSelectedDutyId] = useState<string>('');

  // Only sessions still active/in-process are reportable — a COMPLETED
  // session has attendance already locked (BR-035) and a CANCELLED one
  // never happened, so neither is a valid target for a new incident.
  const duties = (dutiesQuery.data?.items ?? []).filter(
    (d) => d.examSession.status !== 'COMPLETED' && d.examSession.status !== 'CANCELLED',
  );
  const selectedDuty = duties.find((d) => d.id === selectedDutyId);
  const selectedSeatId = form.watch('seat_id');
  const selectedStudentId = form.watch('student_id');

  function onDutyChange(dutyId: string) {
    setSelectedDutyId(dutyId);
    const duty = duties.find((d) => d.id === dutyId);
    form.setValue('exam_session_id', duty?.examSessionId ?? '', { shouldValidate: true });
    form.setValue('room_id', duty?.roomId ?? '');
    form.setValue('seat_id', '');
    form.setValue('student_id', '');
    form.setValue('quiz_id', '');
  }

  function onSeatPick(assignment: SeatingAssignment) {
    form.setValue('seat_id', assignment.seatId);
    form.setValue('student_id', assignment.studentId);
    form.setValue('quiz_id', assignment.quizId);
  }

  function onClearSeat() {
    form.setValue('seat_id', '');
    form.setValue('student_id', '');
    form.setValue('quiz_id', '');
  }

  return (
    <FormProvider {...form}>
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        {rootError && <Alert color="danger">{rootError}</Alert>}

        {myFacultyQuery.isError && (
          <Alert color="danger" title="Couldn't resolve your faculty record">
            An administrator can tell you the exam session and room to report against.
          </Alert>
        )}

        <FormField<IncidentFormValues>
          name="exam_session_id"
          label="Exam Session"
          description="Only exam sessions/rooms you are assigned to invigilate are listed."
          required
        >
          {(field) => (
            <Select
              id={field.id}
              value={selectedDutyId}
              onChange={(e) => onDutyChange(e.target.value)}
              disabled={myFacultyQuery.isLoading || dutiesQuery.isLoading}
              aria-invalid={field['aria-invalid']}
              placeholder={dutiesQuery.isLoading ? 'Loading your duties…' : 'Select an exam session'}
              options={duties.map((d) => ({ value: d.id, label: dutyLabel(d) }))}
            />
          )}
        </FormField>

        {!dutiesQuery.isLoading && duties.length === 0 && !myFacultyQuery.isError && (
          <Alert color="warning" title="No invigilation duties found">
            You aren&apos;t currently assigned to invigilate any exam session. Contact an administrator if this seems wrong.
          </Alert>
        )}

        <FormField<IncidentFormValues> name="incident_type" label="Incident Type" required>
          {(field) => (
            <select
              id={field.id}
              value={(field.value as string) ?? ''}
              onChange={(e) => field.onChange(e.target.value)}
              aria-invalid={field['aria-invalid']}
              className="h-11 w-full rounded border border-border-strong bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <option value="" disabled hidden>
                Select an incident type
              </option>
              {INCIDENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField<IncidentFormValues> name="severity" label="Severity" required>
          {(field) => (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Severity">
              {SEVERITY_OPTIONS.map((opt) => {
                const selected = field.value === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => field.onChange(opt.value)}
                    className={cn(
                      'rounded-sm border px-3 py-2 text-sm font-medium transition-colors duration-150 ease focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                      selected ? opt.classes : 'border-border bg-surface text-text-muted hover:bg-neutral-50',
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </FormField>

        <FormField<IncidentFormValues> name="description" label="Description" required>
          {(field) => (
            <Textarea
              {...field}
              value={(field.value as string) ?? ''}
              onChange={(e) => field.onChange(e.target.value)}
              placeholder="Describe what happened, including relevant times and identifying details."
              rows={5}
            />
          )}
        </FormField>

        {selectedDuty && (
          <div className="flex flex-col gap-2 rounded border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text">Involve a specific student (optional)</p>
              {selectedStudentId && <span className="text-xs text-text-muted">Student attached to this report</span>}
            </div>
            <p className="text-xs text-text-muted">
              Load this room&apos;s seat map and click the student&apos;s seat to attach them to this report.
            </p>
            <IncidentSeatPicker
              duty={selectedDuty}
              selectedSeatId={selectedSeatId || undefined}
              onPick={onSeatPick}
              onClear={onClearSeat}
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={submitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

export { INCIDENT_TYPE_OPTIONS, SEVERITY_OPTIONS };
