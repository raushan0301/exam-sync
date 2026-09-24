import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

/**
 * Parses the first worksheet of an uploaded .xlsx buffer into an array of
 * row objects keyed by the (case-insensitive, trimmed) header row. Row 1 is
 * treated as headers; rows 2+ are data. Fully-blank rows are skipped.
 *
 * File-level problems (not a valid xlsx, missing required headers) throw
 * BadRequestException immediately — fail fast before any per-row processing,
 * since these aren't a single bad row's problem.
 */
export async function parseExcelBuffer(
  buffer: Buffer,
  requiredHeaders: string[],
): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch (err) {
    throw new BadRequestException(
      `The uploaded file is not a valid .xlsx workbook: ${(err as Error).message}`,
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new BadRequestException('The uploaded workbook has no worksheets.');
  }

  const headerRow = sheet.getRow(1);
  const headers: (string | undefined)[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const value = cell.value;
    headers[colNumber] = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : undefined;
  });

  const normalizedHeaders = headers.map((h) => h?.toLowerCase());
  const missing = requiredHeaders.filter(
    (required) => !normalizedHeaders.includes(required.toLowerCase()),
  );
  if (missing.length > 0) {
    throw new BadRequestException(
      `The uploaded file is missing required column(s): ${missing.join(', ')}.`,
    );
  }

  const records: Record<string, string>[] = [];
  const lastRow = sheet.actualRowCount ?? sheet.rowCount;

  for (let rowNumber = 2; rowNumber <= Math.max(lastRow, sheet.rowCount); rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (!row || row.cellCount === 0) continue;

    const record: Record<string, string> = {};
    let hasAnyValue = false;

    for (let colNumber = 1; colNumber < headers.length; colNumber++) {
      const header = headers[colNumber];
      if (!header) continue;
      const cell = row.getCell(colNumber);
      let raw: unknown = cell.value;
      if (raw != null && typeof raw === 'object' && 'text' in (raw as Record<string, unknown>)) {
        raw = (raw as { text: unknown }).text;
      }
      if (raw != null && typeof raw === 'object' && 'result' in (raw as Record<string, unknown>)) {
        raw = (raw as { result: unknown }).result;
      }
      const value = raw == null ? '' : String(raw).trim();
      if (value !== '') hasAnyValue = true;
      record[header] = value;
    }

    if (hasAnyValue) {
      records.push(record);
    }
  }

  return records;
}
