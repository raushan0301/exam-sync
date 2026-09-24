'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search as SearchIcon } from 'lucide-react';
import { cn } from './utils';
import { FieldWrapper, describedByIds } from './FieldWrapper';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Visual group heading (e.g. building) — options are shown grouped, in the order groups first appear. */
  group?: string;
  /** Small right-aligned hint text (e.g. "capacity 42"). */
  hint?: string;
}

export interface SearchableSelectProps {
  id?: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  containerClassName?: string;
}

/**
 * Searchable dropdown for long option lists (100+ rooms) where a native
 * `<select>` becomes an unusable wall of text — a button trigger opens a
 * panel with a search box (filters by label/group as you type) and a
 * grouped, scrollable option list. Not a full combobox: the trigger
 * itself isn't typable, only the panel's search input is.
 */
export function SearchableSelect({
  id,
  label,
  description,
  error,
  required,
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches.',
  disabled,
  containerClassName,
}: SearchableSelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.group?.toLowerCase().includes(q))
      : options;
    const groups: { group: string | undefined; items: SearchableSelectOption[] }[] = [];
    for (const opt of list) {
      const last = groups[groups.length - 1];
      if (last && last.group === opt.group) {
        last.items.push(opt);
      } else {
        groups.push({ group: opt.group, items: [opt] });
      }
    }
    return groups;
  }, [options, query]);

  return (
    <FieldWrapper id={fieldId} label={label} description={description} error={error} required={required}>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          id={fieldId}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-describedby={describedByIds(fieldId, description, error)}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex h-11 w-full items-center justify-between rounded-md border border-border-strong bg-surface px-3 text-sm text-text',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
            disabled && 'cursor-not-allowed opacity-50',
            error && 'border-danger-600',
          )}
        >
          <span className={cn('truncate text-left', !selected && 'text-text-muted')}>{selected ? selected.label : placeholder}</span>
          <ChevronDown size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
        </button>

        {open && (
          <div className="absolute z-dropdown mt-1 flex w-full max-h-80 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-elevated">
            <div className="shrink-0 border-b border-border p-2">
              <div className="flex items-center gap-2 rounded border border-border px-2">
                <SearchIcon size={14} className="shrink-0 text-text-muted" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-9 w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
                />
              </div>
            </div>
            <ul role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
              {filtered.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">{emptyMessage}</li>}
              {filtered.map((group, gi) => (
                <li key={group.group ?? gi}>
                  {group.group && (
                    <div className="bg-surface-muted px-3 py-1 text-xs font-semibold text-text-muted">{group.group}</div>
                  )}
                  <ul>
                    {group.items.map((opt) => (
                      <li key={opt.value}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={opt.value === value}
                          onClick={() => {
                            onChange(opt.value);
                            setOpen(false);
                          }}
                          className={cn(
                            'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors duration-150 ease hover:bg-neutral-100',
                            opt.value === value && 'bg-primary-50 text-primary-700',
                          )}
                        >
                          <span className="truncate">{opt.label}</span>
                          {opt.hint && <span className="ml-2 shrink-0 text-xs text-text-muted">{opt.hint}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </FieldWrapper>
  );
}
