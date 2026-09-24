import ExcelJS from 'exceljs';

export interface BulkImportTemplateColumn {
  header: string;
  example: string;
  note?: string;
}

export interface BulkImportTemplateSpec {
  columns: BulkImportTemplateColumn[];
  entityName: string;
  uniqueFieldsNote: string;
}

/**
 * Generates a two-sheet .xlsx template for a bulk-import feature: a "Data"
 * sheet with a bold header row plus one example row, and an "Instructions"
 * sheet describing each column and the entity's uniqueness rule.
 */
export async function generateExcelTemplate(spec: BulkImportTemplateSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const dataSheet = workbook.addWorksheet('Data');
  dataSheet.addRow(spec.columns.map((c) => c.header));
  dataSheet.getRow(1).font = { bold: true };
  dataSheet.addRow(spec.columns.map((c) => c.example));
  dataSheet.columns = spec.columns.map(() => ({ width: 24 }));

  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.addRow(['Column', 'Notes']);
  instructionsSheet.getRow(1).font = { bold: true };
  for (const column of spec.columns) {
    instructionsSheet.addRow([column.header, column.note ?? '']);
  }
  instructionsSheet.addRow([]);
  instructionsSheet.addRow([`Bulk import: ${spec.entityName}`]);
  instructionsSheet.addRow([spec.uniqueFieldsNote]);
  instructionsSheet.columns = [{ width: 24 }, { width: 60 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
