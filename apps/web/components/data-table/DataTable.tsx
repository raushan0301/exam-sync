'use client';

import type { ReactNode } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Skeleton,
  EmptyState,
  ErrorState,
} from '@/components/ui';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  /** Cell renderer. Receives the row item. */
  render: (item: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (item: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  errorTitle?: string;
  errorDescription?: string;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Extra trailing column for row actions (Edit/Deactivate/etc.), rendered per row. */
  renderActions?: (item: T) => ReactNode;
  /** Number of skeleton rows to render while loading with no cached data yet. */
  skeletonRows?: number;
}

/**
 * Shared list-table shell used by every Academic Structure / People page:
 * loading -> skeleton-shaped rows (not a spinner), error -> ErrorState with
 * retry, empty -> EmptyState with a create CTA, success -> real rows. Built
 * on M1's Table/Skeleton/EmptyState/ErrorState primitives — no per-entity
 * table markup duplication.
 */
export function DataTable<T>({
  columns,
  data,
  getRowKey,
  isLoading,
  isError,
  onRetry,
  retrying,
  errorTitle,
  errorDescription,
  emptyTitle,
  emptyDescription,
  emptyAction,
  renderActions,
  skeletonRows = 5,
}: DataTableProps<T>) {
  if (isError) {
    return <ErrorState title={errorTitle} description={errorDescription} onRetry={onRetry} retrying={retrying} />;
  }

  if (isLoading && data.length === 0) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} align={col.align}>
                {col.header}
              </TableHead>
            ))}
            {renderActions && <TableHead align="right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.key} align={col.align}>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
              ))}
              {renderActions && (
                <TableCell align="right">
                  <Skeleton className="h-4 w-16 ml-auto" />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  if (!isLoading && data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} align={col.align}>
              {col.header}
            </TableHead>
          ))}
          {renderActions && <TableHead align="right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((item) => (
          <TableRow key={getRowKey(item)}>
            {columns.map((col) => (
              <TableCell key={col.key} align={col.align}>
                {col.render(item)}
              </TableCell>
            ))}
            {renderActions && <TableCell align="right">{renderActions(item)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
