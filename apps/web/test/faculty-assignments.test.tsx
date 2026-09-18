import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockFaculty,
  setMockSubjects,
  setMockBatches,
  setMockFacultyAssignments,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
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
    year: 2025,
    section: 'A',
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
    await userEvent.selectOptions(screen.getByLabelText(/^batch/i), BATCH_ID);
    await userEvent.type(screen.getByLabelText(/academic year/i), '2025-2026');
    await userEvent.clear(screen.getByLabelText(/^semester/i));
    await userEvent.type(screen.getByLabelText(/^semester/i), '2');

    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(screen.getByText('Data Structures')).toBeInTheDocument());
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
});
