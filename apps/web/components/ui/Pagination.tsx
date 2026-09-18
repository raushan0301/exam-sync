import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export interface PaginationProps {
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
  className?: string;
}

/** Cursor-based Prev/Next only — no page numbers, since the backend uses opaque cursor tokens. */
export function Pagination({ hasNext, hasPrev, onNext, onPrev, className }: PaginationProps) {
  return (
    <div className={`flex items-center justify-end gap-2 ${className ?? ''}`}>
      <Button
        variant="secondary"
        size="sm"
        onClick={onPrev}
        disabled={!hasPrev}
        leadingIcon={<ChevronLeft size={16} aria-hidden="true" />}
      >
        Prev
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onNext}
        disabled={!hasNext}
        trailingIcon={<ChevronRight size={16} aria-hidden="true" />}
      >
        Next
      </Button>
    </div>
  );
}
