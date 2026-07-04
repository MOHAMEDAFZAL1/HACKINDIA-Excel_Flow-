"use client";

import { Columns3, Rows3, Table2 } from "lucide-react";
import type { SheetData, UiComponent } from "@/lib/ui-schema";
import { useUiStore } from "@/store/ui-store";

type SheetComponent = Extract<UiComponent, { type: "sheet" }>;

type Props = {
  componentId: string;
  component: SheetComponent;
  sheetId?: string;
  onDataChange?: (data: SheetData) => void;
};

export function ExeSheet({ componentId, component, sheetId, onDataChange }: Props) {
  const updateSheet = useUiStore((state) => state.updateSheet);
  const data = component.data;

  function updateCell(rowIndex: number, cellIndex: number, value: string) {
    const nextData: SheetData = {
      ...data,
      rows: data.rows.map((row, currentRowIndex) =>
        currentRowIndex === rowIndex
          ? {
              ...row,
              cells: data.columns.map((column, currentCellIndex) => {
                const cell = row.cells[currentCellIndex] ?? {
                  id: `${row.id}-${column.toLowerCase()}`,
                  value: ""
                };

                if (currentCellIndex !== cellIndex) {
                  return cell;
                }

                const formula = value.startsWith("=") ? value.slice(1) : undefined;
                const { formula: _oldFormula, ...rest } = cell;
                return formula ? { ...rest, value, formula } : { ...rest, value };
              })
            }
          : row
      )
    };

    commitData(nextData);
  }

  function addRow() {
    const nextIndex = data.rows.length + 1;
    const nextData: SheetData = {
      ...data,
      rows: [
        ...data.rows,
        {
          id: `row-${Date.now()}`,
          cells: data.columns.map((column, index) => ({
            id: `row-${nextIndex}-${column.toLowerCase()}-${index}`,
            value: index === 0 ? `Row ${nextIndex}` : ""
          }))
        }
      ]
    };

    commitData(nextData);
  }

  function addColumn() {
    const nextColumn = nextColumnName(data.columns);
    const nextData: SheetData = {
      columns: [...data.columns, nextColumn],
      rows: data.rows.map((row, rowIndex) => ({
        ...row,
        cells: [
          ...row.cells,
          {
            id: `${row.id}-${nextColumn.toLowerCase()}`,
            value: rowIndex === 0 ? nextColumn : ""
          }
        ]
      }))
    };

    commitData(nextData);
  }

  function commitData(nextData: SheetData) {
    if (onDataChange) {
      onDataChange(nextData);
      return;
    }

    updateSheet(componentId, nextData, sheetId);
  }

  return (
    <section className="exe-sheet">
      <div className="sheet-toolbar">
        <div className="sheet-title">
          <Table2 size={20} aria-hidden="true" />
          <div>
            <h3>{component.title}</h3>
            {component.description ? <p>{component.description}</p> : null}
          </div>
        </div>
        <div className="sheet-tools">
          <button className="icon-button secondary" type="button" onClick={addRow} title="Add row">
            <Rows3 size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            onClick={addColumn}
            title="Add column"
          >
            <Columns3 size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="sheet-scroll">
        <table>
          <thead>
            <tr>
              {data.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={row.id}>
                {data.columns.map((column, cellIndex) => {
                  const cell = row.cells[cellIndex] ?? {
                    id: `${row.id}-${column}`,
                    value: ""
                  };

                  return (
                    <td key={cell.id}>
                      <input
                        aria-label={`${column} row ${rowIndex + 1}`}
                        value={cell.formula ? `=${cell.formula}` : cell.value}
                        onChange={(event) =>
                          updateCell(rowIndex, cellIndex, event.target.value)
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function nextColumnName(columns: string[]) {
  const fallbackIndex = columns.length;
  const lastColumn = columns.at(-1);

  if (!lastColumn || !/^[A-Z]+$/.test(lastColumn)) {
    return `Column ${fallbackIndex + 1}`;
  }

  let number = 0;
  for (const character of lastColumn) {
    number = number * 26 + character.charCodeAt(0) - 64;
  }

  number += 1;
  let name = "";

  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }

  return name;
}
