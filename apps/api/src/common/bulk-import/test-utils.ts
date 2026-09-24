import ExcelJS from 'exceljs';

/** Test helper: builds a real .xlsx buffer with a header row + data rows, for exercising parseExcelBuffer/bulkImport in specs. */
export async function buildXlsxBuffer(headers: string[], rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Test helper: reads a `generateExcelTemplate()` buffer's header + first example row off the "Data" sheet, keyed by header. */
export async function readTemplateExampleRow(buffer: Buffer): Promise<Record<string, string>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet('Data')!;
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v));
  const values = (sheet.getRow(2).values as unknown[]).slice(1);
  const result: Record<string, string> = {};
  headers.forEach((h, i) => {
    result[h] = values[i] == null ? '' : String(values[i]);
  });
  return result;
}
