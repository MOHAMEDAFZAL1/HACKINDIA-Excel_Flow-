import * as XLSX from "xlsx";
import type { Cell, SheetData, UiComponent, WorkbookSheet } from "@/lib/ui-schema";

type WorkbookComponent = Extract<UiComponent, { type: "workbook" }>;

export async function fileToWorkbookComponent(file: File): Promise<WorkbookComponent> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    cellFormula: true
  });

  const sheets = workbook.SheetNames.map((name, index) =>
    worksheetToWorkbookSheet(name, workbook.Sheets[name], index)
  );

  return {
    id: "workbook-connected",
    type: "workbook",
    title: "Connected Excel Workbook",
    fileName: file.name,
    activeSheetId: sheets[0]?.id ?? "sheet-1",
    sheets:
      sheets.length > 0
        ? sheets
        : [
            {
              id: "sheet-1",
              name: "Sheet1",
              data: {
                columns: ["A"],
                rows: [{ id: "row-1", cells: [{ id: "a1", value: "" }] }]
              }
            }
          ]
  };
}

export function downloadWorkbook(component: WorkbookComponent) {
  const workbook = XLSX.utils.book_new();

  component.sheets.forEach((sheet) => {
    const worksheet = sheetDataToWorksheet(sheet.data);
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheet.name));
  });

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = resultFileName(component.fileName ?? component.title);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function worksheetToWorkbookSheet(
  name: string,
  worksheet: XLSX.WorkSheet,
  index: number
): WorkbookSheet {
  const decodedRange = worksheet["!ref"]
    ? XLSX.utils.decode_range(worksheet["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const columnCount = Math.max(1, decodedRange.e.c - decodedRange.s.c + 1);
  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    columnName(decodedRange.s.c + columnIndex)
  );

  const rows = Array.from(
    { length: Math.max(1, decodedRange.e.r - decodedRange.s.r + 1) },
    (_, rowOffset) => {
      const rowIndex = decodedRange.s.r + rowOffset;
      return {
        id: `row-${rowIndex + 1}`,
        cells: columns.map((_, columnOffset) => {
          const columnIndex = decodedRange.s.c + columnOffset;
          const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
          const cell = worksheet[address];

          return {
            id: address.toLowerCase(),
            value: cellValueToString(cell),
            ...(cell?.f ? { formula: cell.f } : {})
          };
        })
      };
    }
  );

  return {
    id: `sheet-${index + 1}-${slug(name)}`,
    name,
    data: { columns, rows }
  };
}

function sheetDataToWorksheet(data: SheetData) {
  const aoa = data.rows.map((row) =>
    data.columns.map((_, columnIndex) => cellToSheetJs(row.cells[columnIndex]))
  );

  return XLSX.utils.aoa_to_sheet(aoa);
}

function cellToSheetJs(cell?: Cell) {
  if (!cell) {
    return "";
  }

  const formula = cell.formula ?? formulaFromValue(cell.value);
  if (formula) {
    return {
      f: formula,
      v: coerceValue(cell.value.replace(/^=/, ""))
    };
  }

  return coerceValue(cell.value);
}

function cellValueToString(cell?: XLSX.CellObject) {
  if (!cell) {
    return "";
  }

  if (cell.f && cell.v === undefined) {
    return `=${cell.f}`;
  }

  if (cell.w !== undefined) {
    return String(cell.w);
  }

  if (cell.v instanceof Date) {
    return cell.v.toISOString().slice(0, 10);
  }

  return cell.v === undefined || cell.v === null ? "" : String(cell.v);
}

function coerceValue(value: string) {
  const trimmed = value.trim();

  if (trimmed === "") {
    return "";
  }

  const numericValue = Number(trimmed.replace(/,/g, ""));
  if (!Number.isNaN(numericValue) && /^-?[\d,]+(\.\d+)?$/.test(trimmed)) {
    return numericValue;
  }

  return value;
}

function formulaFromValue(value: string) {
  return value.startsWith("=") ? value.slice(1) : undefined;
}

function columnName(index: number) {
  let name = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "sheet"
  );
}

function safeSheetName(name: string) {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim() || "Sheet";
  return cleaned.slice(0, 31);
}

function resultFileName(fileName: string) {
  const baseName = fileName.replace(/\.xlsx?$/i, "") || "excelflow";
  return `${baseName}-result.xlsx`;
}
