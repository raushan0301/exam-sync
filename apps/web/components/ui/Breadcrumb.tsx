import { ChevronRight } from 'lucide-react';
import { cn } from './utils';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1.5 text-sm', className)}>
      <ol className="flex items-center gap-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <a href={item.href} className="text-text-muted hover:text-text transition-colors duration-150 ease">
                  {item.label}
                </a>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'text-text font-medium' : 'text-text-muted'}>
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRight size={14} className="text-text-subtle" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
