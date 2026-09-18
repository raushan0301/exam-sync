import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { ReportFormat } from '@exam-sync/db';
import { ReportTable } from './generators/report-table';

export interface WrittenReportFile {
  data: Buffer;
  contentType: string;
  extension: string;
}

/**
 * PRD.md FR-046: "Exportable (async, CSV/Excel) reports". `csv-stringify`
 * mirrors Phase 3's `csv-parse` dependency (same package family, sibling
 * import direction — parse for bulk import, stringify for export).
 * `exceljs` is a new dependency justified specifically by this
 * requirement — no XLSX-capable library existed anywhere in this
 * codebase before Phase 19.
 */
export async function writeReportFile(table: ReportTable, format: ReportFormat): Promise<WrittenReportFile> {
  if (format === 'CSV') {
    const csv = stringify([table.headers, ...table.rows]);
    return { data: Buffer.from(csv, 'utf-8'), contentType: 'text/csv', extension: 'csv' };
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  sheet.addRow(table.headers);
  for (const row of table.rows) {
    sheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    data: Buffer.from(buffer),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  };
}
