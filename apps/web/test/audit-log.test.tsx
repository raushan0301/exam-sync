import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setTokens } from '@/lib/token-storage';
import { renderWithProviders } from './utils/renderWithProviders';
import {
  SESSION_TOKENS,
  ADMIN_USER,
  STUDENT_REFRESH_TOKEN,
  setMockAuditLogs,
  type MockAuditLogEntry,
} from './msw/handlers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));

import AdminAuditLogPage from '@/app/admin/audit-log/page';

const NOW = '2026-01-01T00:00:00.000Z';
const ADMIN_TOKEN = 'audit-admin-token';
SESSION_TOKENS[ADMIN_TOKEN] = ADMIN_USER;

function signInAsAdmin() {
  setTokens(ADMIN_TOKEN, STUDENT_REFRESH_TOKEN);
}

function makeAuditEntry(overrides: Partial<MockAuditLogEntry> = {}): MockAuditLogEntry {
  return {
    id: 'audit-1',
    actorId: 'u-admin',
    action: 'UPDATE',
    entityType: 'Quiz',
    entityId: 'quiz-1',
    oldValue: { status: 'DRAFT' },
    newValue: { status: 'SUBMITTED' },
    reason: null,
    requestId: 'req-123',
    academicYear: 2026,
    createdAt: NOW,
    ...overrides,
  };
}

describe('Admin: audit log', () => {
  it('loads entries and filters by entity type', async () => {
    signInAsAdmin();
    setMockAuditLogs([
      makeAuditEntry({ id: 'a1', entityType: 'Quiz', entityId: 'quiz-1' }),
      makeAuditEntry({ id: 'a2', entityType: 'Department', entityId: 'dept-1', action: 'CREATE', oldValue: null, newValue: { name: 'CS' } }),
    ]);
    renderWithProviders(<AdminAuditLogPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Quiz/).length).toBeGreaterThan(0);
    });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/entity type/i), 'Department');
    await user.tab();

    await waitFor(() => {
      expect(screen.queryByText(/quiz-1/)).not.toBeInTheDocument();
    });
  });

  it('shows an empty state when no entries match the filters', async () => {
    signInAsAdmin();
    setMockAuditLogs([]);
    renderWithProviders(<AdminAuditLogPage />);

    await waitFor(() => {
      expect(screen.getByText(/no audit log entries match these filters/i)).toBeInTheDocument();
    });
  });

  it('shows actor id, action, and a readable old->new diff in the detail drawer', async () => {
    signInAsAdmin();
    setMockAuditLogs([makeAuditEntry({ id: 'a1' })]);
    renderWithProviders(<AdminAuditLogPage />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /view/i }).length).toBeGreaterThan(0);
    });

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: /view/i })[0]);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('u-admin')).toBeInTheDocument();
    expect(within(drawer).getByText('status')).toBeInTheDocument();
    expect(within(drawer).getByText('DRAFT')).toBeInTheDocument();
    expect(within(drawer).getByText('SUBMITTED')).toBeInTheDocument();
    expect(within(drawer).getByText('req-123')).toBeInTheDocument();
  });
});
