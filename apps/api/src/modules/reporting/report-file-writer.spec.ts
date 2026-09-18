import ExcelJS from 'exceljs';
import { writeReportFile } from './report-file-writer';

describe('writeReportFile', () => {
  const table = { headers: ['A', 'B'], rows: [['x', 1], ['y', 2]] };

  it('CSV: produces a valid text/csv buffer with a header row', async () => {
    const file = await writeReportFile(table, 'CSV');
    expect(file.contentType).toBe('text/csv');
    expect(file.extension).toBe('csv');
    const text = file.data.toString('utf-8');
    expect(text.split('\n')[0].trim()).toBe('A,B');
    expect(text).toContain('x,1');
    expect(text).toContain('y,2');
  });

  it('EXCEL: produces a valid XLSX buffer readable back by exceljs', async () => {
    const file = await writeReportFile(table, 'EXCEL');
    expect(file.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(file.extension).toBe('xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.data as any);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, 'A', 'B']); // exceljs 1-indexes with a leading undefined
    expect(sheet.getRow(2).values).toEqual([undefined, 'x', 1]);
    expect(sheet.getRow(3).values).toEqual([undefined, 'y', 2]);
  });

  it('handles an empty table without throwing', async () => {
    await expect(writeReportFile({ headers: ['A'], rows: [] }, 'CSV')).resolves.toBeDefined();
    await expect(writeReportFile({ headers: ['A'], rows: [] }, 'EXCEL')).resolves.toBeDefined();
  });
});
