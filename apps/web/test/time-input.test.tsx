import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TimeInput } from '@/components/ui/TimeInput';

function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TimeInput
      label="Preferred Time"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

describe('TimeInput — shows when nothing has been chosen yet', () => {
  it('shows faded "--" placeholders (not a real-looking 9:00 AM) while the value is empty', () => {
    render(<Harness />);

    for (const name of ['Hour', 'Minute', 'AM or PM']) {
      const select = screen.getByLabelText(name) as HTMLSelectElement;
      expect(select.value).toBe('');
      expect(select).toHaveClass('text-text-subtle');
    }
    expect(screen.getAllByText('--')).toHaveLength(3);
  });

  it('picking one part fills the rest with 9:00 AM and drops the faded look', async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);

    await userEvent.selectOptions(screen.getByLabelText('Minute'), '30');

    expect(onValue).toHaveBeenLastCalledWith('09:30');
    expect((screen.getByLabelText('Hour') as HTMLSelectElement).value).toBe('9');
    expect(screen.getByLabelText('Hour')).not.toHaveClass('text-text-subtle');
    expect(screen.queryByText('--')).not.toBeInTheDocument();
  });

  it('an existing value renders normally, with no placeholders', () => {
    render(<Harness initial="14:05" />);

    expect((screen.getByLabelText('Hour') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText('Minute') as HTMLSelectElement).value).toBe('5');
    expect((screen.getByLabelText('AM or PM') as HTMLSelectElement).value).toBe('PM');
    expect(screen.queryByText('--')).not.toBeInTheDocument();
  });
});
