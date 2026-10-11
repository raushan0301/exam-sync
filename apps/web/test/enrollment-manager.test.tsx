import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockSubjects,
  setMockBatches,
  setMockStudents,
  setMockEnrollments,
  ENROLLMENTS,
  ENROLLMENT_REQUESTS,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
} from './msw/handlers';
import { EnrollmentManager } from '@/components/enrollment/EnrollmentManager';

const NOW = '2026-01-01T00:00:00.000Z';
const SUBJECT_A = '44444444-4444-4444-8444-444444444444';
const SUBJECT_B = '55555555-5555-4555-8555-555555555555';
const BATCH = '22222222-2222-4222-8222-222222222222';
const STUDENT = '77777777-7777-4777-8777-777777777777';

function seed() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
  setMockSubjects([
    { id: SUBJECT_A, departmentId: 'd1', programId: null, code: 'UCS301', name: 'Data Structures', credits: 4, isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: SUBJECT_B, departmentId: 'd1', programId: null, code: 'UCS310', name: 'Database Management', credits: 4, isActive: true, createdAt: NOW, updatedAt: NOW },
    { id: 'sub-c', departmentId: 'd1', programId: null, code: 'UMA401', name: 'Probability', credits: 4, isActive: true, createdAt: NOW, updatedAt: NOW },
  ]);
  setMockBatches([{ id: BATCH, programId: 'p1', year: '2024-2028', section: '3C7', subsection: '3C71', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW }]);
  setMockStudents([
    { id: STUDENT, userId: 'u-s', name: 'test1', programId: 'p1', batchId: BATCH, rollNumber: '102403981', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
  ]);
  setMockEnrollments([]);
}

async function fillAndSelect(subjectLabels: string[]) {
  for (const label of subjectLabels) {
    await userEvent.click(await screen.findByLabelText(label));
  }
  await userEvent.type(screen.getByLabelText(/academic year/i), 'TEST-2026');
  await userEvent.type(screen.getByLabelText(/^semester/i), '1');
  await userEvent.click(await screen.findByLabelText('2024-2028 · 3C7-3C71'));
  await userEvent.click(await screen.findByLabelText('102403981 — test1'));
}

describe('EnrollmentManager — multiple subjects at once', () => {
  it('searches the subject list and shows how many are selected', async () => {
    seed();
    renderWithProviders(<EnrollmentManager allowBulkImport />);

    await userEvent.type(await screen.findByLabelText(/search subjects/i), 'ucs3');
    expect(screen.getByLabelText('UCS301 — Data Structures')).toBeInTheDocument();
    expect(screen.queryByLabelText('UMA401 — Probability')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('UCS301 — Data Structures'));
    await userEvent.click(screen.getByLabelText('UCS310 — Database Management'));
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    // A selection survives changing the search text.
    await userEvent.clear(screen.getByLabelText(/search subjects/i));
    await userEvent.type(screen.getByLabelText(/search subjects/i), 'prob');
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByText(/2 selected/i)).not.toBeInTheDocument();
  });

  it('ADMIN: enrolls students x subjects in ONE bulk request', async () => {
    seed();
    renderWithProviders(<EnrollmentManager allowBulkImport />);

    await fillAndSelect(['UCS301 — Data Structures', 'UCS310 — Database Management']);
    await userEvent.click(screen.getByRole('button', { name: /enroll 1 student\(s\) in 2 subject\(s\)/i }));

    expect(await screen.findByText(/2 enrollment\(s\) created/i)).toBeInTheDocument();
    expect(ENROLLMENTS).toHaveLength(2);
    expect(ENROLLMENTS.map((e) => e.subjectId).sort()).toEqual([SUBJECT_A, SUBJECT_B].sort());
    expect(ENROLLMENTS.every((e) => e.batchId === BATCH && e.academicYear === 'TEST-2026')).toBe(true);
    expect(ENROLLMENT_REQUESTS).toEqual([{ path: '/enrollments/bulk', rows: 2 }]); // not one request per row
  });

  it('groups repeated failures into one line with a count', async () => {
    seed();
    setMockEnrollments([
      { id: 'e1', studentId: STUDENT, subjectId: SUBJECT_A, batchId: BATCH, academicYear: 'TEST-2026', semester: 1 },
      { id: 'e2', studentId: STUDENT, subjectId: SUBJECT_B, batchId: BATCH, academicYear: 'TEST-2026', semester: 1 },
    ]);
    renderWithProviders(<EnrollmentManager allowBulkImport />);

    await fillAndSelect(['UCS301 — Data Structures', 'UCS310 — Database Management']);
    await userEvent.click(screen.getByRole('button', { name: /enroll 1 student\(s\) in 2 subject\(s\)/i }));

    expect(await screen.findByText(/0 enrollment\(s\) created/i)).toBeInTheDocument();
    expect(screen.getByText(/2 failed/i)).toBeInTheDocument();
    expect(screen.getByText(/already enrolled in this subject for this academic year\/semester\. \(2\)/i)).toBeInTheDocument();
  });

  it('partial success: creates the new one and reports the duplicate', async () => {
    seed();
    setMockEnrollments([{ id: 'e1', studentId: STUDENT, subjectId: SUBJECT_A, batchId: BATCH, academicYear: 'TEST-2026', semester: 1 }]);
    renderWithProviders(<EnrollmentManager allowBulkImport />);

    await fillAndSelect(['UCS301 — Data Structures', 'UCS310 — Database Management']);
    await userEvent.click(screen.getByRole('button', { name: /enroll 1 student\(s\) in 2 subject\(s\)/i }));

    expect(await screen.findByText(/1 enrollment\(s\) created/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument();
    expect(ENROLLMENTS).toHaveLength(2);
  });

  it('FACULTY (no bulk access): one request per row, and no Bulk Import button', async () => {
    seed();
    renderWithProviders(<EnrollmentManager />);

    expect(screen.queryByRole('button', { name: /bulk import/i })).not.toBeInTheDocument();
    await fillAndSelect(['UCS301 — Data Structures', 'UCS310 — Database Management']);
    await userEvent.click(screen.getByRole('button', { name: /enroll 1 student\(s\) in 2 subject\(s\)/i }));

    expect(await screen.findByText(/2 enrollment\(s\) created/i)).toBeInTheDocument();
    expect(ENROLLMENT_REQUESTS).toEqual([
      { path: '/enrollments', rows: 1 },
      { path: '/enrollments', rows: 1 },
    ]);
  });

  it('ADMIN sees the Bulk Import button', async () => {
    seed();
    renderWithProviders(<EnrollmentManager allowBulkImport />);
    expect(await screen.findByRole('button', { name: /bulk import/i })).toBeInTheDocument();
  });

  it('keeps the enroll button disabled until a subject, term and student are chosen', async () => {
    seed();
    renderWithProviders(<EnrollmentManager allowBulkImport />);

    const button = await screen.findByRole('button', { name: /enroll selected/i });
    expect(button).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText('UCS301 — Data Structures')).toBeInTheDocument());
  });
});
