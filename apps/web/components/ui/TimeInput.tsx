'use client';

import { useId } from 'react';
import { FieldWrapper, describedByIds } from './FieldWrapper';
import { cn } from './utils';

export interface TimeInputProps {
  id?: string;
  /** Renders a visible label above the field via FieldWrapper — omit when an outer wrapper (e.g. FormField) already shows one, and use `ariaLabel` instead so the group still has an accessible name. */
  label?: string;
  /** Accessible name for the group when no visible `label` is rendered here (e.g. inside a FormField that already shows "Start Time" as a plain, non-form-associated label). */
  ariaLabel?: string;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** 24-hour "HH:MM" (or "HH:MM:SS", seconds dropped) — same value shape every existing `type="time"` input in this app already used. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0..59

/** What an unchosen part falls back to the moment the user picks any one part (9:00 AM). */
const DEFAULT_PARTS = { hour12: 9, minute: 0, period: 'AM' } as const;

function parse(value: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { ...DEFAULT_PARTS };
  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, minute, period };
}

function toValue(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const hour24 = period === 'AM' ? (hour12 % 12) : (hour12 % 12) + 12;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const selectClass =
  'h-11 rounded border border-border-strong bg-surface px-2 text-base text-text transition-colors duration-150 ease focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:bg-neutral-100 disabled:text-text-subtle disabled:cursor-not-allowed';

/**
 * Three plain `<select>`s (hour/minute/AM-PM) instead of a native
 * `<input type="time">` — the native control needs you to click into and
 * precisely edit each little segment (hour, then minute, then AM/PM) one
 * at a time, which is slow and fiddly, especially on the first click when
 * it's not obvious which segment has focus. A click-to-pick dropdown per
 * part is faster and far more discoverable, at the cost of losing native
 * keyboard-typing-through — an acceptable trade for how infrequently these
 * forms are filled in. Emits/accepts the same 24-hour "HH:MM" string every
 * existing time field in this app already uses, so it's a drop-in swap.
 */
export function TimeInput({ id, label, ariaLabel, description, error, required, disabled, value, onChange, className }: TimeInputProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const { hour12, minute, period } = parse(value);
  // No time chosen yet: show faded "--" placeholders instead of a real-looking 9:00 AM, so it is obvious a choice is still needed.
  const unset = !/^(\d{1,2}):(\d{2})/.test(value);

  function update(next: Partial<{ hour12: number; minute: number; period: 'AM' | 'PM' }>) {
    onChange(
      toValue(
        next.hour12 ?? hour12,
        next.minute ?? minute,
        next.period ?? period,
      ),
    );
  }

  return (
    <FieldWrapper id={fieldId} label={label} description={description} error={error} required={required}>
      <div
        id={fieldId}
        role="group"
        aria-label={ariaLabel ?? label}
        aria-invalid={!!error || undefined}
        aria-describedby={describedByIds(fieldId, description, error)}
        className={cn('flex items-center gap-1.5', className)}
      >
        <select
          aria-label="Hour"
          value={unset ? '' : hour12}
          disabled={disabled}
          onChange={(e) => update({ hour12: Number(e.target.value) })}
          className={cn(selectClass, unset && 'text-text-subtle', error && 'border-danger-border')}
        >
          {unset && (
            <option value="" disabled hidden>
              --
            </option>
          )}
          {HOURS_12.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-text-muted" aria-hidden="true">:</span>
        <select
          aria-label="Minute"
          value={unset ? '' : minute}
          disabled={disabled}
          onChange={(e) => update({ minute: Number(e.target.value) })}
          className={cn(selectClass, unset && 'text-text-subtle', error && 'border-danger-border')}
        >
          {unset && (
            <option value="" disabled hidden>
              --
            </option>
          )}
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, '0')}
            </option>
          ))}
        </select>
        <select
          aria-label="AM or PM"
          value={unset ? '' : period}
          disabled={disabled}
          onChange={(e) => update({ period: e.target.value as 'AM' | 'PM' })}
          className={cn(selectClass, unset && 'text-text-subtle', error && 'border-danger-border')}
        >
          {unset && (
            <option value="" disabled hidden>
              --
            </option>
          )}
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </FieldWrapper>
  );
}
