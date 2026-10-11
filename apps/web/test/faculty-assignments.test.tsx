import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockFaculty,
  setMockSubjects,
  setMockBatches,
  setMockFacultyAssignments,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
  API_BASE_URL,
  type MockFaculty,
  type MockSubject,
  type MockBatch,
  type MockFacultyAssignment,
} from './msw/handlers';

import FacultyAssignmentsPage from '@/app/admin/people/faculty-assignments/page';

const NOW = '2026-01-01T00:00:00.000Z';

function signInAsAdmin() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

function makeFaculty(overrides: Partial<MockFaculty> = {}): MockFaculty {
  return {
    id: 'fac-1',
    userId: 'u-fac-1',
    name: 'Dr. Smith',
    departmentId: 'dept-1',
    employeeCode: 'E001',
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const SUBJECT_ID = '44444444-4444-4444-8444-444444444444';
const SUBJECT_ID_2 = '55555555-5555-4555-8555-555555555555';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const BATCH_ID_2 = '33333333-3333-4333-8333-333333333333';

function makeSubject(overrides: Partial<MockSubject> = {}): MockSubject {
  return {
    id: SUBJECT_ID,
    departmentId: 'dept-1',
    programId: null,
    code: 'CS101',
    name: 'Intro to CS',
    credits: 4,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeBatch(overrides: Partial<MockBatch> = {}): MockBatch {
  return {
    id: BATCH_ID,
    programId: '11111111-1111-4111-8111-111111111111',
    year: '2025',
    section: 'A',
    subsection: 'A1',
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeAssignment(overrides: Partial<MockFacultyAssignment> = {}): MockFacultyAssignment {
  return {
    id: 'fa-1',
    facultyId: 'fac-1',
    subjectId: SUBJECT_ID,
    batchId: BATCH_ID,
    academicYear: '2025-2026',
    semester: 1,
    role: 'PRIMARY_INSTRUCTOR',
    createdAt: NOW,
    updatedAt: NOW,
    endedAt: null,
    ...overrides,
  };
}

describe('Faculty Assignments', () => {
  it('shows an empty state until a faculty member is selected, then their assignments', async () => {
    signInAsAdmin();
    setMockFaculty([makeFaculty()]);
    setMockSubjects([makeSubject()]);
    setMockBatches([makeBatch()]);
    setMockFacultyAssignments([makeAssignment()]);

    renderWithProviders(<FacultyAssignmentsPage />);

    expect(await screen.findByText(/select a faculty member/i)).toBeInTheDocument();

    const facultySelect = await screen.findByLabelText(/faculty member/i);
    await screen.findByText('E001 — Dr. Smith');
    await userEvent.selectOptions(facultySelect, 'fac-1');

    expect(await screen.findByText('Intro to CS')).toBeInTheDocument();
  });

  it('creates a new teaching assignment', async () => {
    signInAsAdmin();
    setMockFaculty([makeFaculty()]);
    setMockSubjects([makeSubject({ id: SUBJECT_ID_2, code: 'CS102', name: 'Data Structures' })]);
    setMockBatches([makeBatch()]);
    setMockFacultyAssignments([]);

    renderWithProviders(<FacultyAssignmentsPage />);

    const facultySelect = await screen.findByLabelText(/faculty member/i);
    await screen.findByText('E001 — Dr. Smith');
    await userEvent.selectOptions(facultySelect, 'fac-1');

    await screen.findByText(/no teaching assignments/i);
    const addButtons = screen.getAllByRole('button', { name: /add assignment/i });
    await userEvent.click(addButtons[0]);

    await userEvent.selectOptions(screen.getByLabelText(/^subject/i), SUBJECT_ID_2);
    await userEvent.click(screen.getByLabelText('A/A1 (2025)'));
    await userEvent.type(screen.getByLabelText(/academic year/i), '2025-2026');
    await userEvent.clear(screen.getByLabelText(/^semester/i));
    await userEvent.type(screen.getByLabelText(/^semester/i), '2');

    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText('Data Structures')).toBeInTheDocument());
  });

  it('assigns the same faculty/subject to multiple batches in one submit', async () => {
    signInAsAdmin();
    setMockFaculty([makeFaculty()]);
    setMockSubjects([makeSubject({ id: SUBJECT_ID_2, code: 'CS102', name: 'Data Structures' })]);
    setMockBatches([makeBatch(), makeBatch({ id: BATCH_ID_2, section: 'B', subsection: 'B1' })]);
    setMockFacultyAssignments([]);

    renderWithProviders(<FacultyAssignmentsPage />);

    const facultySelect = await screen.findByLabelText(/faculty member/i);
    await screen.findByText('E001 — Dr. Smith');
    await userEvent.selectOptions(facultySelect, 'fac-1');

    await screen.findByText(/no teaching assignments/i);
    await userEvent.click(screen.getAllByRole('button', { name: /add assignment/i })[0]);

    await userEvent.selectOptions(screen.getByLabelText(/^subject/i), SUBJECT_ID_2);
    await userEvent.click(screen.getByLabelText('A/A1 (2025)'));
    await userEvent.click(screen.getByLabelText('B/B1 (2025)'));
    await userEvent.type(screen.getByLabelText(/academic year/i), '2025-2026');
    await userEvent.clear(screen.getByLabelText(/^semester/i));
    await userEvent.type(screen.getByLabelText(/^semester/i), '2');

    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // Two independent assignment rows created — one per selected batch.
    await waitFor(() => expect(screen.getAllByText('Data Structures')).toHaveLength(2));
  });

  it('reports which batch failed without losing the ones that succeeded', async () => {
    signInAsAdmin();
    setMockFaculty([makeFaculty()]);
    setMockSubjects([makeSubject({ id: SUBJECT_ID_2, code: 'CS102', name: 'Data Structures' })]);
    setMockBatches([makeBatch(), makeBatch({ id: BATCH_ID_2, section: 'B', subsection: 'B1' })]);
    // Pre-seed an existing assignment for batch B so that one fails as a duplicate (BR-009).
    setMockFacultyAssignments([
      makeAssignment({
        id: 'fa-existing',
        subjectId: SUBJECT_ID_2,
        batchId: BATCH_ID_2,
        academicYear: '2025-2026',
        semester: 2,
      }),
    ]);

    renderWithProviders(<FacultyAssignmentsPage />);

    const facultySelect = await screen.findByLabelText(/faculty member/i);
    await screen.findByText('E001 — Dr. Smith');
    await userEvent.selectOptions(facultySelect, 'fac-1');

    await screen.findByText('Data Structures');
    await userEvent.click(screen.getAllByRole('button', { name: /add assignment/i })[0]);

    await userEvent.selectOptions(screen.getByLabelText(/^subject/i), SUBJECT_ID_2);
    await userEvent.click(screen.getByLabelText('A/A1 (2025)'));
    await userEvent.click(screen.getByLabelText('B/B1 (2025)'));
    await userEvent.type(screen.getByLabelText(/academic year/i), '2025-2026');
    await userEvent.clear(screen.getByLabelText(/^semester/i));
    await userEvent.type(screen.getByLabelText(/^semester/i), '2');

    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    // Batch A succeeded (now 2 rows total: the pre-seeded B + new A), and
    // the modal stays open reporting exactly which batch failed and why.
    await waitFor(() => expect(screen.getAllByText('Data Structures')).toHaveLength(2));
    expect(await screen.findByText(/assigned 1 of 2 batch/i)).toBeInTheDocument();
    // The failure names the existing assignment (employee code, subject, batch, term) — not a bare "already exists".
    expect(screen.getByText(/already assigned: E001 → CS102/i)).toBeInTheDocument();
    // Only the failed batch stays ticked, so a retry resubmits just that one.
    expect(screen.getByLabelText('B/B1 (2025)')).toBeChecked();
    expect(screen.getByLabelText('A/A1 (2025)')).not.toBeChecked();
  });

  it('ends an assignment', async () => {
    signInAsAdmin();
    setMockFaculty([makeFaculty()]);
    setMockSubjects([makeSubject()]);
    setMockBatches([makeBatch()]);
    setMockFacultyAssignments([makeAssignment()]);

    renderWithProviders(<FacultyAssignmentsPage />);

    const facultySelect = await screen.findByLabelText(/faculty member/i);
    await screen.findByText('E001 — Dr. Smith');
    await userEvent.selectOptions(facultySelect, 'fac-1');

    await screen.findByText('Intro to CS');
    await userEvent.click(screen.getByRole('button', { name: /^end$/i }));
    await userEvent.click(screen.getByRole('button', { name: /end assignment/i }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /^end$/i })).not.toBeInTheDocument());
  });

  it('filters the faculty dropdown as you type, but keeps the selected person listed', async () => {
    signInAsAdmin();
    setMockFaculty([
      makeFaculty(),
      makeFaculty({ id: 'fac-2', name: 'Dr. Jones', employeeCode: 'E002' }),
      makeFaculty({ id: 'fac-3', name: 'Dr. Patel', employeeCode: 'X900' }),
    ]);
    setMockSubjects([makeSubject()]);
    setMockBatches([makeBatch()]);
    setMockFacultyAssignments([]);

    renderWithProviders(<FacultyAssignmentsPage />);
    await screen.findByText('E001 — Dr. Smith');

    await userEvent.type(screen.getByLabelText(/search faculty/i), 'jones');
    expect(screen.queryByText('E001 — Dr. Smith')).not.toBeInTheDocument();
    expect(screen.getByText('E002 — Dr. Jones')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/^faculty member/i), 'fac-2');
    await userEvent.clear(screen.getByLabelText(/search faculty/i));
    await userEvent.type(screen.getByLabelText(/search faculty/i), 'patel');
    // The person already chosen stays in the list even when the search no longer matches them.
    expect(screen.getByText('E002 — Dr. Jones')).toBeInTheDocument();
    expect(screen.getByText('X900 — Dr. Patel')).toBeInTheDocument();
  });

  it('selects all matching batches with one click, and Clear empties the selection', async () => {
    signInAsAdmin();
    setMockFaculty([makeFaculty()]);
    setMockSubjects([makeSubject()]);
    setMockBatches([
      makeBatch(),
      makeBatch({ id: BATCH_ID_2, section: 'B', subsection: 'B1' }),
      makeBatch({ id: '66666666-6666-4666-8666-666666666666', section: 'C', subsection: 'C1' }),
    ]);
    setMockFacultyAssignments([]);

    renderWithProviders(<FacultyAssignmentsPage />);
    await screen.findByText('E001 — Dr. Smith');
    await userEvent.selectOptions(await screen.findByLabelText(/^faculty member/i), 'fac-1');
    await screen.findByText(/no teaching assignments/i);
    await userEvent.click(screen.getAllByRole('button', { name: /add assignment/i })[0]);

    await userEvent.type(screen.getByLabelText(/search batches/i), 'B1');
    await userEvent.click(screen.getByLabelText(/select all matching \(1\)/i));
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    expect(screen.getByLabelText('B/B1 (2025)')).toBeChecked();

    await userEvent.clear(screen.getByLabelText(/search batches/i));
    await userEvent.click(screen.getByLabelText(/select all \(3\)/i));
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByText(/\d+ selected/i)).toBeInTheDocument(); // counter still shown...
    expect(screen.getByText(/0 selected/i)).toBeInTheDocument(); // ...at zero
  });

  it('lists EVERY faculty member even when the server paginates (page cap is 200)', async () => {
    signInAsAdmin();
    setMockSubjects([makeSubject()]);
    setMockBatches([makeBatch()]);
    setMockFacultyAssignments([]);
    const everyone = Array.from({ length: 250 }, (_, i) =>
      makeFaculty({ id: `fac-${i}`, name: `Faculty ${i}`, employeeCode: `EMP${String(i).padStart(3, '0')}` }),
    );
    const requestedLimits: (string | null)[] = [];
    server.use(
      http.get(`${API_BASE_URL}/faculty`, ({ request }) => {
        const url = new URL(request.url);
        requestedLimits.push(url.searchParams.get('limit'));
        // Behave like the real API: at most 200 per page, opaque cursor = last id of the previous page.
        const cursor = url.searchParams.get('cursor');
        const start = cursor ? everyone.findIndex((f) => f.id === cursor) + 1 : 0;
        const page = everyone.slice(start, start + 200);
        return HttpResponse.json({
          items: page,
          next_cursor: start + 200 < everyone.length ? page[page.length - 1].id : null,
        });
      }),
    );

    renderWithProviders(<FacultyAssignmentsPage />);

    // The 250th person (only reachable via page 2) is selectable, and the count says so.
    expect(await screen.findByRole('option', { name: 'EMP249 — Faculty 249' })).toBeInTheDocument();
    expect(screen.getByText(/select a faculty member \(250 people\)/i)).toBeInTheDocument();
    expect(requestedLimits).toEqual(['200', '200']);
  });
});
