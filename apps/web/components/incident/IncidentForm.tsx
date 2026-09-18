'use client';

import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { Input, Textarea, FormField, Button, Alert } from '@/components/ui';
import { cn } from '@/components/ui/utils';
import type { IncidentSeverity, IncidentType } from '@/lib/queries/types';

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
  exam_session_id: z.string().uuid('Enter a valid exam session ID.'),
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

/**
 * FACULTY incident-report form matching CreateIncidentDto exactly.
 * `exam_session_id` is a plain UUID text input: there is no faculty-
 * scoped exam-session list endpoint this app can use here (the one
 * candidate, `useInvigilationDuties`, is documented at
 * app/faculty/invigilation-duties/page.tsx as unusable — `GET /users/me`
 * never returns a faculty id, so that hook can't resolve "my" duties
 * client-side either). Faculty type the session id they're invigilating;
 * the backend independently 403s (BR-037) if they aren't actually on that
 * session's invigilator roster.
 */
export function IncidentForm({ form, onSubmit, submitLabel, submitting, rootError }: IncidentFormProps) {
  return (
    <FormProvider {...form}>
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        {rootError && <Alert color="danger">{rootError}</Alert>}

        <FormField<IncidentFormValues>
          name="exam_session_id"
          label="Exam Session ID"
          description="The exam session you are invigilating. Ask an administrator if you don't have this ID."
          required
        >
          {(field) => (
            <Input
              {...field}
              value={(field.value as string) ?? ''}
              onChange={(e) => field.onChange(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          )}
        </FormField>

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

        <div className="grid grid-cols-2 gap-4">
          <FormField<IncidentFormValues> name="quiz_id" label="Quiz ID (optional)">
            {(field) => (
              <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />
            )}
          </FormField>
          <FormField<IncidentFormValues> name="student_id" label="Student ID (optional)">
            {(field) => (
              <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />
            )}
          </FormField>
          <FormField<IncidentFormValues> name="room_id" label="Room ID (optional)">
            {(field) => (
              <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />
            )}
          </FormField>
          <FormField<IncidentFormValues> name="seat_id" label="Seat ID (optional)">
            {(field) => (
              <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />
            )}
          </FormField>
        </div>

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
