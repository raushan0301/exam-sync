'use client';

import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal, Button, DateInput, TimeInput, FormField, Alert } from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { mapError } from '@/lib/error-mapping';
import type { ConflictDetail, ExamSessionDetail } from '@/lib/queries/types';
import { useRescheduleExamSession, type RescheduleExamSessionInput } from '@/lib/mutations/useExamSessionMutations';
import { ConflictResultDisplay } from './ConflictResultDisplay';

const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/;

const rescheduleSchema = z.object({
  session_date: z.string().min(1, 'Date is required.'),
  start_time: z.string().regex(TIME_REGEX, 'Start time must be in HH:MM format.'),
  end_time: z.string().regex(TIME_REGEX, 'End time must be in HH:MM format.'),
});

type RescheduleFormValues = z.infer<typeof rescheduleSchema>;

export interface RescheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ExamSessionDetail;
}

/** Reschedule action — Modal + form. A 409 (EC-021) renders its `details` via ConflictResultDisplay. */
export function RescheduleModal({ open, onOpenChange, session }: RescheduleModalProps) {
  const rescheduleMutation = useRescheduleExamSession(session.id);
  const conflictDetails =
    rescheduleMutation.error instanceof ApiError && rescheduleMutation.error.status === 409
      ? ((rescheduleMutation.error.details as ConflictDetail[] | undefined) ?? [])
      : null;

  const form = useForm<RescheduleFormValues>({
    resolver: zodResolver(rescheduleSchema),
    values: {
      session_date: session.sessionDate.slice(0, 10),
      start_time: session.startTime.slice(11, 16) || session.startTime.slice(0, 5),
      end_time: session.endTime.slice(11, 16) || session.endTime.slice(0, 5),
    },
  });

  async function onSubmit(values: RescheduleFormValues) {
    const input: RescheduleExamSessionInput = values;
    try {
      await rescheduleMutation.mutateAsync(input);
      onOpenChange(false);
    } catch {
      // surfaced below via rescheduleMutation.error / conflictDetails
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) rescheduleMutation.reset();
      }}
      title="Reschedule exam session"
      description={`Change the date/time for "${session.name}". Assigned students will be notified.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={rescheduleMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={form.handleSubmit(onSubmit)} loading={rescheduleMutation.isPending}>
            Reschedule
          </Button>
        </>
      }
    >
      <FormProvider {...form}>
        <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
          {rescheduleMutation.isError && conflictDetails === null && (
            <Alert color="danger" title="Couldn't reschedule">
              {mapError(rescheduleMutation.error).description}
            </Alert>
          )}
          {conflictDetails !== null && (
            <ConflictResultDisplay hard={conflictDetails} warnings={[]} />
          )}

          <FormField<RescheduleFormValues> name="session_date" label="Date" required>
            {(field) => <DateInput {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField<RescheduleFormValues> name="start_time" label="Start Time" required>
              {(field) => <TimeInput id={field.id} ariaLabel="Start Time" value={(field.value as string) ?? ''} onChange={(v) => field.onChange(v)} />}
            </FormField>
            <FormField<RescheduleFormValues> name="end_time" label="End Time" required>
              {(field) => <TimeInput id={field.id} ariaLabel="End Time" value={(field.value as string) ?? ''} onChange={(v) => field.onChange(v)} />}
            </FormField>
          </div>
        </form>
      </FormProvider>
    </Modal>
  );
}
