export interface ImportRowResult {
  row: number;
  status: 'SUCCESS' | 'FAILURE';
  id?: string;
  error?: string;
}

export interface CreateImportJobInput {
  resourceType: string;
  totalRows: number;
  successCount: number;
  failureCount: number;
  results: ImportRowResult[];
  createdByUserId: string;
}
