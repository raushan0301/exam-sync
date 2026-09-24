import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockDepartments,
  setMockPrograms,
  setMockBatches,
  setMockSubjects,
  setMockFaculty,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
} from './msw/handlers';
import ProgramsPage from '@/app/admin/academic-structure/programs/page';
import BatchesPage from '@/app/admin/academic-structure/batches/page';
import SubjectsPage from '@/app/admin/academic-structure/subjects/page';
import FacultyPage from '@/app/admin/people/faculty/page';

const DEPT_ID = '11111111-1111-4111-8111-111111111111';
const PROGRAM_ID = '22222222-2222-4222-8222-222222222222';

function signInAsAdmin() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

const NOW = '2026-01-01T00:00:00.000Z';

describe('Admin > Academic Structure > Programs', () => {
  it('lists, creates, and reports a 409 on duplicate code', async () => {
    signInAsAdmin();
    setMockDepartments([{ id: DEPT_ID, name: 'Computer Science', code: 'CS', status: 'ACTIVE', metadata: null, createdAt: NOW, updatedAt: NOW }]);
    setMockPrograms([{ id: PROGRAM_ID, departmentId: DEPT_ID, name: 'B.Tech CSE', code: 'BTCSE', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW }]);
    const user = userEvent.setup();

    renderWithProviders(<ProgramsPage />);
    expect(await screen.findByText('B.Tech CSE')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'New Program' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Department/i), DEPT_ID);
    await user.type(within(dialog).getByLabelText(/Name/i), 'B.Tech ECE');
    await user.type(within(dialog).getByLabelText(/Code/i), 'BTCSE'); // duplicate on purpose
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/Code/i));
    await user.type(within(dialog).getByLabelText(/Code/i), 'BTECE');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('B.Tech ECE')).toBeInTheDocument();
  });
});

describe('Admin > Academic Structure > Batches', () => {
  it('lists and creates a batch (no search UI, per batches.controller.ts)', async () => {
    signInAsAdmin();
    setMockPrograms([{ id: PROGRAM_ID, departmentId: DEPT_ID, name: 'B.Tech CSE', code: 'BTCSE', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW }]);
    setMockBatches([]);
    const user = userEvent.setup();

    renderWithProviders(<BatchesPage />);
    expect(await screen.findByText('No batches found')).toBeInTheDocument();
    // No search input should be present for batches.
    expect(screen.queryByLabelText(/Search/i)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'New Batch' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Program/i), PROGRAM_ID);
    await user.clear(within(dialog).getByLabelText(/Year/i));
    await user.type(within(dialog).getByLabelText(/Year/i), '2026');
    await user.type(within(dialog).getByLabelText(/^Section/i), 'A');
    await user.type(within(dialog).getByLabelText(/^Subsection/i), 'A1');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('A')).toBeInTheDocument();
  });
});

describe('Admin > Academic Structure > Subjects', () => {
  it('lists subjects using is_active (not status) and shows the right badge', async () => {
    signInAsAdmin();
    setMockDepartments([{ id: DEPT_ID, name: 'Computer Science', code: 'CS', status: 'ACTIVE', metadata: null, createdAt: NOW, updatedAt: NOW }]);
    setMockSubjects([
      { id: 'sub1', departmentId: DEPT_ID, programId: null, code: 'CS101', name: 'Data Structures', credits: 4, isActive: false, createdAt: NOW, updatedAt: NOW },
    ]);

    renderWithProviders(<SubjectsPage />);

    expect(await screen.findByText('Data Structures')).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Inactive')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('shows a validation error when code/name are missing', async () => {
    signInAsAdmin();
    setMockDepartments([{ id: DEPT_ID, name: 'Computer Science', code: 'CS', status: 'ACTIVE', metadata: null, createdAt: NOW, updatedAt: NOW }]);
    setMockSubjects([]);
    const user = userEvent.setup();

    renderWithProviders(<SubjectsPage />);
    await screen.findByText('No subjects found');

    await user.click(screen.getAllByRole('button', { name: 'New Subject' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Department/i), DEPT_ID);
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByText('Code is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Name is required.')).toBeInTheDocument();
  });
});

describe('Admin > People > Faculty', () => {
  it('lists, creates, and reports a 409 on duplicate employee code', async () => {
    signInAsAdmin();
    setMockDepartments([{ id: DEPT_ID, name: 'Computer Science', code: 'CS', status: 'ACTIVE', metadata: null, createdAt: NOW, updatedAt: NOW }]);
    setMockFaculty([
      { id: 'f1', userId: 'u1', name: 'Dr. Mehta', departmentId: DEPT_ID, employeeCode: 'EMP001', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<FacultyPage />);
    expect(await screen.findByText('Dr. Mehta')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'New Faculty' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name/i), 'Dr. Iyer');
    await user.type(within(dialog).getByLabelText(/Email/i), 'iyer@example.com');
    await user.selectOptions(within(dialog).getByLabelText(/Department/i), DEPT_ID);
    await user.type(within(dialog).getByLabelText(/Employee Code/i), 'EMP001');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();
  });
});
