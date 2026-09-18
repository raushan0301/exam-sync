/**
 * Generic tabular shape every report generator (below) produces —
 * deliberately format-agnostic (`report-file-writer.ts` turns this into
 * CSV or XLSX bytes) and DB-agnostic (each generator is a pure function
 * of already-fetched plain objects, not a Prisma query itself), so
 * "make report calculations deterministic and testable" is satisfiable
 * with plain unit tests, no DB/Nest bootstrap required.
 */
export interface ReportTable {
  headers: string[];
  rows: (string | number | null)[][];
}
