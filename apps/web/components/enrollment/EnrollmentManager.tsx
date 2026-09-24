'use client';

import { useState } from 'react';
import { Card, Select, Input, Checkbox, Button, Alert, LoadingState, EmptyState } from '@/components/ui';
import { useSubjects } from '@/lib/queries/useSubjects';
import { useBatches } from '@/lib/queries/useBatches';
import { useStudentsForBatches } from '@/lib/queries/useStudents';
import { useCreateEnrollment } from '@/lib/mutations/useEnrollmentMutations';
import { mapError } from '@/lib/error-mapping';

/**
 * Enrollment tool (ADMIN and FACULTY — `POST /enrollments` allows both):
 * pick a subject + academic year/semester, pick one or more sections, then
 * multi-select students from those sections to enroll in one go. There is
 * no bulk-enroll endpoint available to FACULTY (`POST /enrollments/bulk`
 * is ADMIN-only) and no "list enrollments for a subject" endpoint at all
 * (only `GET /students/{id}/enrollments`), so this is a write-only tool —
 * one `POST /enrollments` per selected student, fired in parallel, with a
 * success/failure summary — same shape as RosterPanel's multi-add.
 */
export function EnrollmentManager() {
  const [subjectId, setSubjectId] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [semester, setSemester] = useState<number | ''>('');
  const [batchIds, setBatchIds] = useState<Set<string>>(new Set());
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<{ success: number; failure: number; error?: string } | null>(null);

  const subjectsQuery = useSubjects({ isActive: true, limit: 200 });
  const batchesQuery = useBatches({ status: 'ACTIVE', limit: 200 });
  const studentsQuery = useStudentsForBatches(Array.from(batchIds));
  const createMutation = useCreateEnrollment();

  const canSubmit = !!subjectId && academicYear.trim().length > 0 && semester !== '' && studentIds.size > 0;

  function toggleBatch(batchId: string) {
    setBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
    setStudentIds(new Set());
  }

  function toggleStudent(studentId: string) {
    setStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setStudentIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }

  async function onEnroll() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSummary(null);

    const targets = studentsQuery.items.filter((s) => studentIds.has(s.id));
    const results = await Promise.allSettled(
      targets.map((s) =>
        createMutation.mutateAsync({
          student_id: s.id,
          subject_id: subjectId,
          batch_id: s.batchId,
          academic_year: academicYear,
          semester: Number(semester),
        }),
      ),
    );

    setSubmitting(false);
    const success = results.filter((r) => r.status === 'fulfilled').length;
    const failure = results.length - success;
    if (failure > 0) {
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      setSummary({ success, failure, error: firstFailure ? mapError(firstFailure.reason).description : undefined });
    } else {
      setSummary({ success, failure });
      setStudentIds(new Set());
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Enrollments</h1>
        <p className="text-sm text-text-muted">Enroll students in a subject for a given academic year/semester.</p>
      </div>

      <Card>
        <div className="flex flex-col gap-4">
          {summary && (
            <Alert color={summary.failure > 0 ? 'warning' : 'success'} title="Enrollment complete" dismissible>
              {summary.success} student(s) enrolled successfully.
              {summary.failure > 0 && ` ${summary.failure} failed${summary.error ? ` (${summary.error})` : ''}.`}
            </Alert>
          )}

          <Select
            label="Subject"
            required
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            options={(subjectsQuery.data?.items ?? []).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
            placeholder={subjectsQuery.isLoading ? 'Loading subjects…' : 'Select a subject'}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Academic Year"
              required
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              placeholder="2025-2026"
            />
            <Input
              label="Semester"
              type="number"
              min={1}
              required
              value={semester}
              onChange={(e) => setSemester(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text">
              Section(s) / Batch(es) <span className="text-danger-text">*</span>
            </span>
            {batchesQuery.isLoading ? (
              <LoadingState label="Loading sections…" />
            ) : (batchesQuery.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No sections found" />
            ) : (
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border p-2">
                {batchesQuery.data!.items.map((b) => (
                  <Checkbox
                    key={b.id}
                    label={`${b.year} · ${b.section}-${b.subsection}`}
                    checked={batchIds.has(b.id)}
                    onChange={() => toggleBatch(b.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {batchIds.size > 0 && (
            <div className="flex flex-col gap-2">
              {studentsQuery.isLoading ? (
                <LoadingState label="Loading students in the selected section(s)…" />
              ) : studentsQuery.items.length === 0 ? (
                <EmptyState title="No students in the selected section(s)" />
              ) : (
                <>
                  <Checkbox
                    label={`Select all (${studentsQuery.items.length})`}
                    checked={studentsQuery.items.every((s) => studentIds.has(s.id))}
                    onChange={() => toggleSelectAll(studentsQuery.items.map((s) => s.id))}
                  />
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border border-border p-2">
                    {studentsQuery.items.map((s) => (
                      <Checkbox
                        key={s.id}
                        label={`${s.rollNumber} — ${s.name}`}
                        checked={studentIds.has(s.id)}
                        onChange={() => toggleStudent(s.id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={onEnroll} disabled={!canSubmit} loading={submitting}>
              Enroll {studentIds.size > 0 ? `${studentIds.size} ` : ''}Selected
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
