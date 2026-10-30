'use client';

import { useEffect } from 'react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { z } from 'zod';
import { Input, Select, Textarea, DateInput, TimeInput, Checkbox, FormField, Button, Alert } from '@/components/ui';
import { useSubjects } from '@/lib/queries/useSubjects';
import { useBatches } from '@/lib/queries/useBatches';
import { useEligibleStudentCount } from '@/lib/queries/useEligibleStudentCount';
import type { Quiz } from '@/lib/queries/types';

/**
 * Matches CreateQuizDto/UpdateQuizDto (apps/api/src/modules/quiz/dto)
 * exactly. `student_count` (the expected headcount for this quiz's
 * cohort) replaces the old `total_marks`/`question_count` fields — it's
 * what RoomSuggestionService sizes rooms/classes against once the exam
 * session is built, so it's required, not optional. `preferred_date` and
 * `preferred_time` are also required — a faculty must commit to a slot up
 * front rather than leaving scheduling to fill in later.
 */
export const quizFormSchema = z.object({
  title: z.string().min(1, 'Title is required.'),
  subject_id: z.string().uuid('Select a subject.'),
  batch_ids: z.array(z.string().uuid()).min(1, 'Select at least one batch.'),
  academic_year: z.string().min(1, 'Academic year is required.'),
  semester: z.coerce.number().int('Semester must be a whole number.').min(1, 'Semester must be at least 1.'),
  duration_minutes: z.union([z.coerce.number().int().min(1), z.literal('')]).optional(),
  student_count: z.coerce.number().int('Number of students must be a whole number.').min(1, 'Number of students is required.'),
  instructions: z.string().optional(),
  quiz_type: z.string().optional(),
  preferred_date: z.string().min(1, 'Preferred date is required.'),
  preferred_time: z
    .string()
    .min(1, 'Preferred time is required.')
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Preferred time must be in HH:MM format.'),
});

export type QuizFormValues = z.infer<typeof quizFormSchema>;

/**
 * Edit-mode variant: `batch_ids` has no minimum. `GET /quizzes/{id}` does
 * not return the quiz's current batch assignments anywhere (verified —
 * quiz-access.repository.ts returns the raw `Quiz` row only, and there is
 * no `GET /quizzes/{id}/batches` endpoint on the real backend) so the
 * edit form cannot pre-check the quiz's existing batches. `batch_ids` is
 * therefore optional here and omitted from the PATCH payload entirely
 * when the faculty leaves every checkbox unchecked — `UpdateQuizDto`
 * treats an absent `batch_ids` as "leave existing assignments unchanged,"
 * which is the only way to edit a quiz without forcing a re-selection of
 * every batch on every save. See the milestone report for this gap.
 */
export const editQuizFormSchema = quizFormSchema.extend({
  batch_ids: z.array(z.string().uuid()),
});
export type EditQuizFormValues = z.infer<typeof editQuizFormSchema>;

export function defaultQuizFormValues(quiz?: Quiz | null, batchIds?: string[]): QuizFormValues {
  return {
    title: quiz?.title ?? '',
    subject_id: quiz?.subjectId ?? '',
    batch_ids: batchIds ?? [],
    academic_year: quiz?.academicYear ?? '',
    semester: quiz?.semester ?? 1,
    duration_minutes: quiz?.durationMinutes ?? '',
    student_count: quiz?.studentCount ?? ('' as unknown as number),
    instructions: quiz?.instructions ?? '',
    quiz_type: quiz?.quizType ?? '',
    preferred_date: quiz?.preferredDate ? quiz.preferredDate.slice(0, 10) : '',
    preferred_time: quiz?.preferredTime ? quiz.preferredTime.slice(0, 5) : '',
  };
}

/**
 * Strips empty-string optional numeric fields down to `undefined` before
 * sending to the API. `omitEmptyBatchIds` (edit mode) drops `batch_ids`
 * from the payload entirely when none are checked, so PATCH leaves the
 * quiz's existing batch assignments untouched instead of clearing them.
 */
export function toQuizApiPayload(values: QuizFormValues, omitEmptyBatchIds = false) {
  return {
    title: values.title,
    subject_id: values.subject_id,
    batch_ids: omitEmptyBatchIds && values.batch_ids.length === 0 ? undefined : values.batch_ids,
    academic_year: values.academic_year,
    semester: Number(values.semester),
    duration_minutes: values.duration_minutes === '' || values.duration_minutes === undefined ? undefined : Number(values.duration_minutes),
    student_count: Number(values.student_count),
    instructions: values.instructions || undefined,
    quiz_type: values.quiz_type || undefined,
    preferred_date: values.preferred_date,
    preferred_time: values.preferred_time,
  };
}

export interface QuizFormProps {
  form: ReturnType<typeof useForm<QuizFormValues>>;
  onSubmit: (values: QuizFormValues) => void | Promise<void>;
  submitLabel: string;
  submitting?: boolean;
  rootError?: string;
  /** Auto-fill "Number of Students" from real enrollment as subject/batches/year/semester are picked — only sensible for a brand-new quiz (a pre-filled edit-mode value would otherwise get silently overwritten on load). */
  autoFillStudentCount?: boolean;
}

/**
 * Shared create/edit quiz form — used at faculty/quizzes/new and from the
 * quiz detail page's edit mode. Subject is a single Select (useSubjects);
 * batches are a checkbox list (useBatches) since there is no existing
 * multi-select primitive and the batch count per program is small.
 */
export function QuizForm({ form, onSubmit, submitLabel, submitting, rootError, autoFillStudentCount = false }: QuizFormProps) {
  const { data: subjectsData } = useSubjects({ all: true, isActive: true });
  const { data: batchesData } = useBatches({ all: true, status: 'ACTIVE' });
  const subjectOptions = (subjectsData?.items ?? []).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));
  const batches = batchesData?.items ?? [];

  // Auto-fills "Number of Students" from real enrollment as soon as
  // subject + batches + academic year + semester are all picked — the
  // faculty can still freely overwrite it; once they've typed their own
  // value (`isDirty`), a later batch/subject change no longer clobbers it.
  const watchedSubjectId = form.watch('subject_id');
  const watchedBatchIds = form.watch('batch_ids');
  const watchedAcademicYear = form.watch('academic_year');
  const watchedSemester = form.watch('semester');
  const eligibleCountQuery = useEligibleStudentCount({
    subjectId: autoFillStudentCount ? watchedSubjectId : '',
    batchIds: autoFillStudentCount ? watchedBatchIds : [],
    academicYear: autoFillStudentCount ? watchedAcademicYear : '',
    semester: autoFillStudentCount ? watchedSemester : '',
  });
  useEffect(() => {
    if (!autoFillStudentCount) return;
    if (eligibleCountQuery.data === undefined) return;
    if (form.formState.dirtyFields.student_count) return;
    form.setValue('student_count', eligibleCountQuery.data.count, { shouldValidate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFillStudentCount, eligibleCountQuery.data]);

  return (
    <FormProvider {...form}>
      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        {rootError && <Alert color="danger">{rootError}</Alert>}

        <FormField<QuizFormValues> name="title" label="Title" required>
          {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
        </FormField>

        <FormField<QuizFormValues> name="subject_id" label="Subject" required>
          {(field) => (
            <Select
              {...field}
              value={(field.value as string) ?? ''}
              onChange={(e) => field.onChange(e.target.value)}
              options={subjectOptions}
              placeholder="Select a subject"
            />
          )}
        </FormField>

        <Controller
          name="batch_ids"
          control={form.control}
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text">
                Batches <span className="text-danger-text">*</span>
              </span>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border border-border p-2">
                {batches.length === 0 && <p className="text-sm text-text-muted">No active batches available.</p>}
                {batches.map((b) => {
                  const checked = (field.value as string[]).includes(b.id);
                  return (
                    <Checkbox
                      key={b.id}
                      label={`${b.section}/${b.subsection} (${b.year})`}
                      checked={checked}
                      onChange={(e) => {
                        const current = field.value as string[];
                        field.onChange(e.target.checked ? [...current, b.id] : current.filter((id) => id !== b.id));
                      }}
                    />
                  );
                })}
              </div>
              {fieldState.error && (
                <p role="alert" className="text-xs text-danger-text">
                  {fieldState.error.message}
                </p>
              )}
            </div>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField<QuizFormValues> name="academic_year" label="Academic Year" required>
            {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} placeholder="2025-2026" />}
          </FormField>
          <FormField<QuizFormValues> name="semester" label="Semester" required>
            {(field) => (
              <Input
                type="number"
                min={1}
                {...field}
                value={(field.value as number | string) ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
              />
            )}
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField<QuizFormValues> name="duration_minutes" label="Duration (minutes)">
            {(field) => (
              <Input
                type="number"
                min={1}
                {...field}
                value={(field.value as number | string) ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
              />
            )}
          </FormField>
          <FormField<QuizFormValues>
            name="student_count"
            label="Number of Students"
            required
            description={
              autoFillStudentCount && eligibleCountQuery.data
                ? `Auto-filled from ${eligibleCountQuery.data.count} enrolled student${eligibleCountQuery.data.count === 1 ? '' : 's'} — edit to override.`
                : undefined
            }
          >
            {(field) => (
              <Input
                type="number"
                min={1}
                {...field}
                value={(field.value as number | string) ?? ''}
                onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
              />
            )}
          </FormField>
        </div>

        <FormField<QuizFormValues> name="quiz_type" label="Quiz Type">
          {(field) => <Input {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} placeholder="QUIZ, MIDTERM, FINAL…" />}
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField<QuizFormValues> name="preferred_date" label="Preferred Date" required>
            {(field) => <DateInput {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
          </FormField>
          <FormField<QuizFormValues> name="preferred_time" label="Preferred Time" required>
            {(field) => <TimeInput id={field.id} ariaLabel="Preferred Time" value={(field.value as string) ?? ''} onChange={(v) => field.onChange(v)} />}
          </FormField>
        </div>

        <FormField<QuizFormValues> name="instructions" label="Instructions">
          {(field) => <Textarea {...field} value={(field.value as string) ?? ''} onChange={(e) => field.onChange(e.target.value)} />}
        </FormField>

        <div className="flex justify-end">
          <Button type="submit" loading={submitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
