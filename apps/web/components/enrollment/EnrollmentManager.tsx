'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Card, Input, Checkbox, Button, Alert, LoadingState, EmptyState } from '@/components/ui';
import { useSubjects } from '@/lib/queries/useSubjects';
import { useBatches } from '@/lib/queries/useBatches';
import { useStudentsForBatches } from '@/lib/queries/useStudents';
import { useCreateEnrollment, useBulkEnroll, useBulkImportEnrollments, downloadEnrollmentTemplate } from '@/lib/mutations/useEnrollmentMutations';
import { fetchImportJob } from '@/lib/mutations/useStudentMutations';
import { BulkImportModal } from '@/components/bulk-import/BulkImportModal';
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
export interface EnrollmentManagerProps {
  /**
   * ADMIN mode: shows the Excel bulk-import button and enrolls through the single-request
   * `POST /enrollments/bulk` (both ADMIN-gated). Without it (FACULTY) enrollment is one
   * `POST /enrollments` per row.
   */
  allowBulkImport?: boolean;
}

export function EnrollmentManager({ allowBulkImport = false }: EnrollmentManagerProps) {
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const bulkImportMutation = useBulkImportEnrollments();
  const [subjectIds, setSubjectIds] = useState<Set<string>>(new Set());
  const [subjectSearch, setSubjectSearch] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [semester, setSemester] = useState<number | ''>('');
  const [batchIds, setBatchIds] = useState<Set<string>>(new Set());
  const [studentIds, setStudentIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<{ success: number; failure: number; reasons: { message: string; count: number }[] } | null>(null);

  const subjectsQuery = useSubjects({ isActive: true, all: true });
  const batchesQuery = useBatches({ status: 'ACTIVE', all: true });
  const studentsQuery = useStudentsForBatches(Array.from(batchIds));
  const createMutation = useCreateEnrollment();
  const bulkEnrollMutation = useBulkEnroll();

  const allSubjects = subjectsQuery.data?.items ?? [];
  const visibleSubjects = allSubjects.filter((s) =>
    `${s.code} ${s.name}`.toLowerCase().includes(subjectSearch.trim().toLowerCase()),
  );

  const canSubmit = subjectIds.size > 0 && academicYear.trim().length > 0 && semester !== '' && studentIds.size > 0;

  function toggleBatch(batchId: string) {
    setBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
    setStudentIds(new Set());
  }

  function toggleSubject(subjectId: string) {
    setSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
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
    const rows = targets.flatMap((s) =>
      Array.from(subjectIds).map((subjectId) => ({
        student_id: s.id,
        subject_id: subjectId,
        batch_id: s.batchId,
        academic_year: academicYear,
        semester: Number(semester),
      })),
    );

    const errors: string[] = [];
    let success = 0;
    try {
      if (allowBulkImport) {
        const job = await bulkEnrollMutation.mutateAsync(rows);
        success = job.successCount;
        for (const r of job.results) if (r.status === 'FAILURE') errors.push(r.error ?? 'Unknown error');
      } else {
        // FACULTY can't call /enrollments/bulk — one request per row, a few at a time.
        const CONCURRENCY = 5;
        for (let i = 0; i < rows.length; i += CONCURRENCY) {
          const settled = await Promise.allSettled(rows.slice(i, i + CONCURRENCY).map((r) => createMutation.mutateAsync(r)));
          for (const r of settled) {
            if (r.status === 'fulfilled') success++;
            else errors.push(mapError(r.reason).description);
          }
        }
      }
    } catch (err) {
      errors.push(...Array(rows.length - success).fill(mapError(err).description));
    }

    const counts = new Map<string, number>();
    for (const e of errors) counts.set(e, (counts.get(e) ?? 0) + 1);
    setSubmitting(false);
    setSummary({
      success,
      failure: errors.length,
      reasons: Array.from(counts, ([message, count]) => ({ message, count })),
    });
    if (errors.length === 0) setStudentIds(new Set());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Enrollments</h1>
          <p className="text-sm text-text-muted">Enroll students in one or more subjects for a given academic year/semester.</p>
        </div>
        {allowBulkImport && (
          <Button variant="secondary" leadingIcon={<Upload size={16} aria-hidden="true" />} onClick={() => setBulkImportOpen(true)}>
            Bulk Import
          </Button>
        )}
      </div>

      <Card>
        <div className="flex flex-col gap-4">
          {summary && (
            <Alert color={summary.failure > 0 ? 'warning' : 'success'} title="Enrollment complete" dismissible>
              {summary.success} enrollment(s) created.
              {summary.failure > 0 && ` ${summary.failure} failed:`}
              {summary.reasons.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {summary.reasons.map((r) => (
                    <li key={r.message}>
                      {r.message} ({r.count})
                    </li>
                  ))}
                </ul>
              )}
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">
                Subject(s) <span className="text-danger-text">*</span>
              </span>
              {subjectIds.size > 0 && (
                <span className="flex items-center gap-2 text-xs text-text-muted">
                  {subjectIds.size} selected
                  <button type="button" className="text-primary-700 hover:underline" onClick={() => setSubjectIds(new Set())}>
                    Clear
                  </button>
                </span>
              )}
            </div>
            {subjectsQuery.isLoading ? (
              <LoadingState label="Loading subjects…" />
            ) : (
              <>
                <Input
                  aria-label="Search subjects"
                  placeholder="Search by code or name…"
                  value={subjectSearch}
                  onChange={(e) => setSubjectSearch(e.target.value)}
                />
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border border-border p-2">
                  {visibleSubjects.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-text-muted">No subjects match.</p>
                  ) : (
                    visibleSubjects.map((s) => (
                      <Checkbox
                        key={s.id}
                        label={`${s.code} — ${s.name}`}
                        checked={subjectIds.has(s.id)}
                        onChange={() => toggleSubject(s.id)}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>

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
              {studentIds.size > 0 && subjectIds.size > 0
                ? `Enroll ${studentIds.size} student(s) in ${subjectIds.size} subject(s)`
                : 'Enroll Selected'}
            </Button>
          </div>
        </div>
      </Card>

      {allowBulkImport && (
        <BulkImportModal
          open={bulkImportOpen}
          onClose={() => setBulkImportOpen(false)}
          entityLabel="Enrollment"
          onDownloadTemplate={downloadEnrollmentTemplate}
          onUpload={(file) => bulkImportMutation.mutateAsync(file)}
          onPollJob={fetchImportJob}
        />
      )}
    </div>
  );
}
