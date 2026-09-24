import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  setMockStudents,
  setMockPrograms,
  setMockBatches,
  VALID_ACCESS_TOKEN,
  VALID_REFRESH_TOKEN,
} from './msw/handlers';
import StudentsPage from '@/app/admin/people/students/page';

function signInAsAdmin() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

function seedProgramAndBatch() {
  setMockPrograms([
    { id: '11111111-1111-4111-8111-111111111111', departmentId: 'd1', name: 'B.Tech CSE', code: 'BTCSE', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  setMockBatches([
    { id: '22222222-2222-4222-8222-222222222222', programId: '11111111-1111-4111-8111-111111111111', year: '2026', section: 'A', subsection: 'A1', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
}

describe('Admin > People > Students', () => {
  it('loads and lists students', async () => {
    signInAsAdmin();
    seedProgramAndBatch();
    setMockStudents([
      { id: '33333333-3333-4333-8333-333333333333', userId: 'u1', name: 'Asha Rao', programId: '11111111-1111-4111-8111-111111111111', batchId: '22222222-2222-4222-8222-222222222222', rollNumber: 'CS26A01', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    renderWithProviders(<StudentsPage />);

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('CS26A01')).toBeInTheDocument();
  });

  it('creates a new student with name/email/program/batch/roll number', async () => {
    signInAsAdmin();
    seedProgramAndBatch();
    setMockStudents([]);
    const user = userEvent.setup();

    renderWithProviders(<StudentsPage />);
    await screen.findByText('No students found');

    await user.click(screen.getAllByRole('button', { name: 'New Student' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name/i), 'Vikram Singh');
    await user.type(within(dialog).getByLabelText(/Email/i), 'vikram@example.com');
    await user.selectOptions(within(dialog).getByLabelText(/Program/i), '11111111-1111-4111-8111-111111111111');
    await user.selectOptions(within(dialog).getByLabelText(/Batch/i), '22222222-2222-4222-8222-222222222222');
    await user.type(within(dialog).getByLabelText(/Roll Number/i), 'CS26A02');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Vikram Singh')).toBeInTheDocument();
  });

  it('shows a 409 conflict message for a duplicate roll number', async () => {
    signInAsAdmin();
    seedProgramAndBatch();
    setMockStudents([
      { id: '33333333-3333-4333-8333-333333333333', userId: 'u1', name: 'Asha Rao', programId: '11111111-1111-4111-8111-111111111111', batchId: '22222222-2222-4222-8222-222222222222', rollNumber: 'CS26A01', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<StudentsPage />);
    await screen.findByText('Asha Rao');

    await user.click(screen.getAllByRole('button', { name: 'New Student' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name/i), 'Duplicate Student');
    await user.type(within(dialog).getByLabelText(/Email/i), 'dup@example.com');
    await user.selectOptions(within(dialog).getByLabelText(/Program/i), '11111111-1111-4111-8111-111111111111');
    await user.selectOptions(within(dialog).getByLabelText(/Batch/i), '22222222-2222-4222-8222-222222222222');
    await user.type(within(dialog).getByLabelText(/Roll Number/i), 'CS26A01');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();
  });

  it('submits an .xlsx bulk-import and shows the per-row results once the job completes', async () => {
    signInAsAdmin();
    seedProgramAndBatch();
    setMockStudents([]);
    const user = userEvent.setup();

    renderWithProviders(<StudentsPage />);
    await screen.findByText('No students found');

    await user.click(screen.getByRole('button', { name: 'Bulk Import' }));
    const dialog = await screen.findByRole('dialog');

    const file = new File(['dummy xlsx content'], 'students.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    // The file input has no accessible name/role in BulkImportModal — query
    // by its type attribute directly, matching the component's own markup
    // (a bare <input type="file">).
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));

    expect(await within(dialog).findByText(/1 of 1 row\(s\) imported successfully/i)).toBeInTheDocument();
  });
});
