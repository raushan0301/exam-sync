'use client';

import { EnrollmentManager } from '@/components/enrollment/EnrollmentManager';

export default function AdminEnrollmentsPage() {
  return <EnrollmentManager allowBulkImport />;
}
