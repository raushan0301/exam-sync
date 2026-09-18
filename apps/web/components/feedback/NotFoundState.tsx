import { SearchX } from 'lucide-react';
import { EmptyState } from '@/components/ui';

export function NotFoundState() {
  return (
    <EmptyState
      icon={<SearchX size={28} aria-hidden="true" />}
      title="Not found"
      description="The page or resource you're looking for doesn't exist."
    />
  );
}
