'use client';

/**
 * Internal dev-only component showcase — NOT part of the product IA, not
 * linked from any nav (Admin/Faculty/Student sidebars). Renders every
 * Milestone 1 primitive with realistic variants/states for visual audit.
 * Route: /design-system.
 */

import { useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bell, Download, MoreHorizontal, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { Switch } from '@/components/ui/Switch';
import { Badge } from '@/components/ui/Badge';
import { STATUS_CONFIG, StatusBadge } from '@/components/ui/StatusBadge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import { Dropdown } from '@/components/ui/Dropdown';
import { Tabs } from '@/components/ui/Tabs';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Alert } from '@/components/ui/Alert';
import { useToast } from '@/components/ui/Toast';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Pagination } from '@/components/ui/Pagination';
import { Search } from '@/components/ui/Search';
import { FilterBar, FilterChip } from '@/components/ui/FilterBar';
import { DateRangeInput } from '@/components/ui/DateInput';
import { Skeleton, SkeletonText, SkeletonCircle } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { FormField } from '@/components/ui/FormField';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-border py-10 first:pt-0 last:border-b-0">
      <h2 className="mb-5 text-xl font-semibold text-text">{title}</h2>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-14 w-full rounded-md border border-border" style={{ background: hex }} />
      <p className="text-xs font-medium text-text">{name}</p>
      <p className="font-mono text-xs text-text-subtle">{hex}</p>
    </div>
  );
}

const NEUTRAL_RAMP: Record<string, string> = {
  50: '#f7f8f9',
  100: '#eceef1',
  200: '#dde1e6',
  300: '#c3c9d1',
  400: '#9aa3af',
  500: '#717a87',
  600: '#545c68',
  700: '#3d4350',
  800: '#282c36',
  900: '#181b21',
  950: '#0e1014',
};

const PRIMARY_RAMP: Record<string, string> = {
  50: '#eff8fa',
  100: '#dceff3',
  200: '#b8dfe7',
  300: '#89c8d6',
  400: '#4fa8bc',
  500: '#2e8aa1',
  600: '#256f83',
  700: '#20596a',
  800: '#1d4a58',
  900: '#1a3e4a',
  950: '#0d2731',
};

const MOCK_QUIZZES = [
  { id: 'QZ-1042', title: 'Data Structures — Midterm', subject: 'CS201', date: '2026-09-22', status: 'APPROVED' },
  { id: 'QZ-1043', title: 'Thermodynamics Unit Test', subject: 'ME310', date: '2026-09-23', status: 'SUBMITTED' },
  { id: 'QZ-1044', title: 'Organic Chemistry Quiz 3', subject: 'CH205', date: '2026-09-24', status: 'DRAFT' },
  { id: 'QZ-1045', title: 'Linear Algebra Retest', subject: 'MA110', date: '2026-09-25', status: 'REJECTED' },
  { id: 'QZ-1046', title: 'Circuit Theory Final', subject: 'EE220', date: '2026-09-28', status: 'FINALIZED' },
];

const quizFormSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  subject: z.string().min(1, 'Select a subject'),
  notes: z.string().optional(),
});
type QuizFormValues = z.infer<typeof quizFormSchema>;

export default function DesignSystemShowcasePage() {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filters, setFilters] = useState(['status: SUBMITTED', 'subject: CS201']);
  const [switchOn, setSwitchOn] = useState(true);
  const [radioValue, setRadioValue] = useState('sequential');

  const form = useFormContextDemo();

  const statusEntries = Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-wide text-primary-600">
          Internal · Dev-only · Not linked from product navigation
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-text">Exam-Sync Design System</h1>
        <p className="mt-2 max-w-2xl text-base text-text-muted">
          Milestone 1 component showcase — every primitive from{' '}
          <code className="font-mono text-sm">components/ui/</code>, rendered with realistic states for visual
          and accessibility audit.
        </p>
      </header>

      <Section id="typography" title="Typography">
        <div className="flex flex-col gap-3">
          <p className="text-3xl font-semibold">30px / semibold — Page title</p>
          <p className="text-2xl font-semibold">24px / semibold — Section heading</p>
          <p className="text-xl font-medium">20px / medium — Card heading</p>
          <p className="text-lg font-medium">18px / medium — Subheading</p>
          <p className="text-md font-normal">16px / normal — Emphasized body</p>
          <p className="text-base font-normal">14px / normal — Default body text</p>
          <p className="text-sm text-text-muted">13px — Dense table cell / metadata</p>
          <p className="text-xs text-text-subtle">12px — Caption / helper text</p>
          <p className="font-mono text-base">IBM Plex Mono — REQ-98213-af92 · SEAT-B12 · 2026-09-16T09:30:00Z</p>
        </div>
      </Section>

      <Section id="colors" title="Colors">
        <div>
          <p className="mb-2 text-sm font-medium text-text">Neutral ramp</p>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11">
            {Object.entries(NEUTRAL_RAMP).map(([k, v]) => (
              <Swatch key={k} name={`neutral-${k}`} hex={v} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-text">Primary ramp</p>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11">
            {Object.entries(PRIMARY_RAMP).map(([k, v]) => (
              <Swatch key={k} name={`primary-${k}`} hex={v} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-text">Semantic status colors</p>
          <div className="flex flex-wrap gap-3">
            <Badge color="success">Success</Badge>
            <Badge color="warning">Warning</Badge>
            <Badge color="danger">Danger</Badge>
            <Badge color="info">Info</Badge>
            <Badge color="neutral">Neutral</Badge>
          </div>
        </div>
      </Section>

      <Section id="buttons" title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary / Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button leadingIcon={<Plus size={16} aria-hidden="true" />}>With leading icon</Button>
          <Button trailingIcon={<Download size={16} aria-hidden="true" />}>With trailing icon</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip content="Delete quiz">
            <IconButton icon={<Trash2 size={16} aria-hidden="true" />} aria-label="Delete quiz" variant="destructive" />
          </Tooltip>
          <IconButton icon={<Bell size={16} aria-hidden="true" />} aria-label="Notifications" variant="secondary" />
          <IconButton icon={<MoreHorizontal size={16} aria-hidden="true" />} aria-label="More actions" variant="tertiary" />
        </div>
      </Section>

      <Section id="form-controls" title="Form Controls">
        <FormProvider {...form}>
          <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(() => toast({ title: 'Quiz draft saved', variant: 'success' }))}>
            <FormField<QuizFormValues> name="title" label="Quiz title" required>
              {(field) => (
                <input
                  id={field.id}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  aria-invalid={field['aria-invalid']}
                  aria-describedby={field['aria-describedby']}
                  className="h-11 w-full rounded border border-border-strong bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  placeholder="e.g. Data Structures — Midterm"
                />
              )}
            </FormField>
            <FormField<QuizFormValues> name="subject" label="Subject" required>
              {(field) => (
                <select
                  id={field.id}
                  value={(field.value as string) ?? ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  aria-invalid={field['aria-invalid']}
                  aria-describedby={field['aria-describedby']}
                  className="h-11 w-full rounded border border-border-strong bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <option value="">Select a subject…</option>
                  <option value="CS201">CS201 — Data Structures</option>
                  <option value="ME310">ME310 — Thermodynamics</option>
                </select>
              )}
            </FormField>
            <div className="sm:col-span-2">
              <Button type="submit">Save draft (FormField + react-hook-form + zod)</Button>
            </div>
          </form>
        </FormProvider>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Session name" placeholder="e.g. Autumn Midterms Week 1" required />
          <Input label="Room code" description="Auto-generated, read-only" value="RM-A204" readOnly />
          <Input label="Invalid example" defaultValue="ab" error="Must be at least 3 characters" required />
          <Input label="Disabled example" placeholder="Not editable" disabled />
          <Select
            label="Report type"
            required
            placeholder="Choose a report type…"
            options={[
              { value: 'attendance', label: 'Attendance' },
              { value: 'seating', label: 'Seating Plan' },
              { value: 'incident', label: 'Incident Report' },
            ]}
          />
          <Textarea label="Rejection reason" required description="Visible to the submitting faculty member" placeholder="Explain why this quiz is being rejected…" />
        </div>

        <div className="flex flex-wrap gap-6">
          <Checkbox label="Notify students by email" defaultChecked />
          <Checkbox label="Disabled option" disabled />
          <Switch label="Auto-lock attendance on completion" checked={switchOn} onChange={(e) => setSwitchOn(e.target.checked)} />
        </div>

        <RadioGroup name="seating-strategy" label="Seating strategy" orientation="horizontal">
          <Radio label="Sequential" checked={radioValue === 'sequential'} onChange={() => setRadioValue('sequential')} />
          <Radio label="Random" checked={radioValue === 'random'} onChange={() => setRadioValue('random')} />
          <Radio label="Anti-Cheating" checked={radioValue === 'anti-cheating'} onChange={() => setRadioValue('anti-cheating')} />
        </RadioGroup>

        <DateRangeInput start={dateFrom} end={dateTo} onStartChange={setDateFrom} onEndChange={setDateTo} />
      </Section>

      <Section id="badges-status" title="Badges & Status">
        <div>
          <p className="mb-2 text-sm font-medium text-text">Every STATUS_CONFIG value (visual audit row)</p>
          <div className="flex flex-wrap gap-2">
            {statusEntries.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </div>
      </Section>

      <Section id="cards" title="Cards">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card header={<p className="font-medium text-text">Pending Approvals</p>} footer={<Button size="sm" variant="tertiary">View queue</Button>}>
            <p className="text-3xl font-semibold text-text">12</p>
            <p className="text-sm text-text-muted">quizzes awaiting review</p>
          </Card>
          <Card padding="dense">
            <p className="mb-1 font-medium text-text">Dense card (no header/footer)</p>
            <p className="text-sm text-text-muted">Used for compact dashboard tiles.</p>
          </Card>
        </div>
      </Section>

      <Section id="overlays" title="Overlays (Modal / Drawer / Tooltip / Dropdown)">
        <div className="flex flex-wrap gap-3">
          <Modal
            open={modalOpen}
            onOpenChange={setModalOpen}
            title="Reject quiz"
            description="This will notify the submitting faculty member."
            trigger={<Button variant="secondary">Open Modal</Button>}
            footer={
              <>
                <Button variant="secondary" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setModalOpen(false);
                    toast({ title: 'Quiz rejected', variant: 'danger' });
                  }}
                >
                  Reject
                </Button>
              </>
            }
          >
            <Textarea label="Reason" required placeholder="Explain the rejection…" />
          </Modal>

          <Drawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            title="QZ-1043 — Thermodynamics Unit Test"
            description="Submitted by Dr. A. Rao · ME310"
            trigger={<Button variant="secondary">Open Drawer</Button>}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
                  Close
                </Button>
                <Button onClick={() => setDrawerOpen(false)}>Approve</Button>
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <StatusBadge status="SUBMITTED" />
              <p className="text-sm text-text-muted">Full quiz detail + approval history would render here.</p>
            </div>
          </Drawer>

          <Tooltip content="Quiz has 3 unresolved warnings">
            <Button variant="secondary">Hover for Tooltip</Button>
          </Tooltip>

          <Dropdown
            trigger={<Button variant="secondary">Open Dropdown</Button>}
            items={[
              { label: 'Edit', onSelect: () => toast({ title: 'Edit selected', variant: 'info' }) },
              { label: 'Duplicate', onSelect: () => toast({ title: 'Duplicated', variant: 'success' }) },
              { label: 'Delete', danger: true, onSelect: () => toast({ title: 'Deleted', variant: 'danger' }) },
            ]}
          />

          <Button onClick={() => toast({ title: 'Report generated', description: 'CSV ready for download.', variant: 'success' })}>
            Trigger Toast
          </Button>
        </div>
      </Section>

      <Section id="tabs-breadcrumb" title="Tabs & Breadcrumb">
        <Breadcrumb
          items={[{ label: 'Exam Sessions', href: '#' }, { label: 'Autumn Midterms Week 1', href: '#' }, { label: 'Seating' }]}
        />
        <Tabs
          items={[
            { value: 'overview', label: 'Overview', content: <p className="text-sm text-text-muted">Session overview content.</p> },
            { value: 'quizzes', label: 'Quizzes', content: <p className="text-sm text-text-muted">Attached quizzes list.</p> },
            { value: 'rooms', label: 'Rooms', content: <p className="text-sm text-text-muted">Allocated rooms list.</p> },
            { value: 'seating', label: 'Seating', content: <p className="text-sm text-text-muted">Seat map preview.</p> },
          ]}
        />
      </Section>

      <Section id="alerts-toasts" title="Alerts & Toasts">
        <Alert color="info" title="3 unresolved WARNING conflicts">
          These do not block session creation but should be reviewed before finalizing.
        </Alert>
        <Alert color="warning" title="Approaching submission deadline" dismissible>
          Quiz submissions close in 2 hours for this session.
        </Alert>
        <Alert color="danger" title="Attendance record is locked">
          This session completed on 2026-09-10. Corrections require a reason.
        </Alert>
        <Alert color="success">Room allocation confirmed for all 4 sessions.</Alert>
        <p className="text-sm text-text-muted">
          Use the “Trigger Toast” button in the Overlays section above for a live toast demo (bottom-right,
          auto-dismiss).
        </p>
      </Section>

      <Section id="tables-pagination" title="Tables & Pagination">
        <FilterBar>
          <Search value={search} onChange={setSearch} label="" placeholder="Search quizzes…" debounceMs={250} />
          {filters.map((f) => (
            <FilterChip key={f} label={f} onRemove={() => setFilters((prev) => prev.filter((x) => x !== f))} />
          ))}
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Exam Date</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MOCK_QUIZZES.map((q) => (
              <TableRow key={q.id} clickable>
                <TableCell mono>{q.id}</TableCell>
                <TableCell>{q.title}</TableCell>
                <TableCell>{q.subject}</TableCell>
                <TableCell mono>{q.date}</TableCell>
                <TableCell>
                  <StatusBadge status={q.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination hasPrev={false} hasNext onPrev={() => {}} onNext={() => toast({ title: 'Loaded next page', variant: 'info' })} />
      </Section>

      <Section id="loading-empty-error" title="Loading, Empty & Error States">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card padding="dense">
            <p className="mb-3 text-sm font-medium text-text">Skeleton</p>
            <div className="flex items-center gap-3">
              <SkeletonCircle size={36} />
              <SkeletonText lines={2} className="flex-1" />
            </div>
          </Card>
          <Card padding="dense">
            <p className="mb-3 text-sm font-medium text-text">LoadingState</p>
            <LoadingState label="Generating seating plan…" />
          </Card>
          <Card padding="dense">
            <p className="mb-3 text-sm font-medium text-text">EmptyState</p>
            <EmptyState title="No quizzes yet" description="Create your first quiz to get started." action={<Button size="sm">Create quiz</Button>} />
          </Card>
        </div>
        <Card padding="dense">
          <p className="mb-3 text-sm font-medium text-text">ErrorState</p>
          <ErrorState title="Couldn't load exam sessions" onRetry={() => toast({ title: 'Retrying…', variant: 'info' })} />
        </Card>
        <div className="flex gap-4">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-40" />
        </div>
      </Section>

      <Section id="confirmation-dialogs" title="Confirmation Dialogs">
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          Cancel session…
        </Button>
        <ConfirmationDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Cancel exam session?"
          description="This will cancel the session and notify 214 assigned students and 6 faculty. This cannot be undone."
          confirmLabel="Cancel session"
          cancelLabel="Keep session"
          destructive
          loading={confirmLoading}
          onConfirm={() => {
            setConfirmLoading(true);
            setTimeout(() => {
              setConfirmLoading(false);
              setConfirmOpen(false);
              toast({ title: 'Session cancelled', variant: 'danger' });
            }, 900);
          }}
        />
      </Section>
    </div>
  );
}

/** Local hook wrapper so the top-level component body stays declarative. */
function useFormContextDemo() {
  return useForm<QuizFormValues>({
    resolver: zodResolver(quizFormSchema),
    defaultValues: { title: '', subject: '', notes: '' },
  });
}
