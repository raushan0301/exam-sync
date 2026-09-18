import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import { setMockDepartments } from './msw/handlers';
import { VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN } from './msw/handlers';
import DepartmentsPage from '@/app/admin/academic-structure/departments/page';

function signInAsAdmin() {
  setTokens(VALID_ACCESS_TOKEN, VALID_REFRESH_TOKEN);
}

describe('Admin > Academic Structure > Departments', () => {
  it('loads and lists departments', async () => {
    signInAsAdmin();
    setMockDepartments([
      {
        id: 'd1',
        name: 'Computer Science',
        code: 'CS',
        status: 'ACTIVE',
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    renderWithProviders(<DepartmentsPage />);

    expect(await screen.findByText('Computer Science')).toBeInTheDocument();
    expect(screen.getByText('CS')).toBeInTheDocument();
  });

  it('shows an empty state with a create CTA when there are no departments', async () => {
    signInAsAdmin();
    setMockDepartments([]);

    renderWithProviders(<DepartmentsPage />);

    expect(await screen.findByText('No departments found')).toBeInTheDocument();
  });

  it('creates a new department', async () => {
    signInAsAdmin();
    setMockDepartments([]);
    const user = userEvent.setup();

    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('No departments found');

    await user.click(screen.getAllByRole('button', { name: 'New Department' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name/i), 'Mathematics');
    await user.type(within(dialog).getByLabelText(/Code/i), 'MATH');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Mathematics')).toBeInTheDocument();
  });

  it('edits an existing department', async () => {
    signInAsAdmin();
    setMockDepartments([
      {
        id: 'd1',
        name: 'Computer Science',
        code: 'CS',
        status: 'ACTIVE',
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('Computer Science');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText(/Name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Computer Science & Engineering');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Computer Science & Engineering')).toBeInTheDocument();
  });

  it('deactivates a department after confirmation', async () => {
    signInAsAdmin();
    setMockDepartments([
      {
        id: 'd1',
        name: 'Computer Science',
        code: 'CS',
        status: 'ACTIVE',
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('Computer Science');

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Inactive')).toBeInTheDocument();
  });

  it('shows a validation error when required fields are missing', async () => {
    signInAsAdmin();
    setMockDepartments([]);
    const user = userEvent.setup();

    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('No departments found');

    await user.click(screen.getAllByRole('button', { name: 'New Department' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByText('Name is required.')).toBeInTheDocument();
    expect(within(dialog).getByText('Code is required.')).toBeInTheDocument();
  });

  it('shows a 409 conflict message when the department code already exists', async () => {
    signInAsAdmin();
    setMockDepartments([
      {
        id: 'd1',
        name: 'Computer Science',
        code: 'CS',
        status: 'ACTIVE',
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const user = userEvent.setup();

    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('Computer Science');

    await user.click(screen.getAllByRole('button', { name: 'New Department' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Name/i), 'Duplicate Dept');
    await user.type(within(dialog).getByLabelText(/Code/i), 'CS');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();
  });
});
