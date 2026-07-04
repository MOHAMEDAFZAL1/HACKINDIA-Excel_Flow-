"use client";

import { ChangeEvent, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { ExeSheet } from "@/components/exe-sheet";
import { downloadWorkbook, fileToWorkbookComponent } from "@/lib/excel-bridge";
import type { UiComponent } from "@/lib/ui-schema";
import { useUiStore } from "@/store/ui-store";

type WorkbookComponent = Extract<UiComponent, { type: "workbook" }>;

type Props = {
  componentId: string;
  component: WorkbookComponent;
};

export function ExeWorkbook({ componentId, component }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const setActiveWorkbookSheet = useUiStore((state) => state.setActiveWorkbookSheet);
  const upsertWorkbook = useUiStore((state) => state.upsertWorkbook);
  const activeSheet =
    component.sheets.find((sheet) => sheet.id === component.activeSheetId) ??
    component.sheets[0];

  async function importWorkbook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsImporting(true);

    try {
      const importedWorkbook = await fileToWorkbookComponent(file);
      upsertWorkbook({ ...importedWorkbook, id: componentId });
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  return (
    <section className="exe-workbook">
      <div className="workbook-toolbar">
        <div className="sheet-title">
          <FileSpreadsheet size={20} aria-hidden="true" />
          <div>
            <h3>{component.title}</h3>
            <p>{component.fileName ?? "No source file connected"}</p>
          </div>
        </div>

        <div className="workbook-actions">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={importWorkbook}
          />
          <button
            className="tool-button secondary"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            <Upload size={17} aria-hidden="true" />
            <span>{isImporting ? "Importing" : "Import"}</span>
          </button>
          <button
            className="tool-button"
            type="button"
            onClick={() => downloadWorkbook(component)}
          >
            <Download size={17} aria-hidden="true" />
            <span>Export</span>
          </button>
        </div>
      </div>

      <div className="workbook-tabs" role="tablist" aria-label="Workbook sheets">
        {component.sheets.map((sheet) => (
          <button
            key={sheet.id}
            type="button"
            role="tab"
            aria-selected={sheet.id === activeSheet?.id}
            className={sheet.id === activeSheet?.id ? "active" : ""}
            onClick={() => setActiveWorkbookSheet(componentId, sheet.id)}
          >
            {sheet.name}
          </button>
        ))}
      </div>

      {activeSheet ? (
        <ExeSheet
          componentId={componentId}
          sheetId={activeSheet.id}
          component={{
            id: activeSheet.id,
            type: "sheet",
            title: activeSheet.name,
            description: `${activeSheet.data.rows.length} rows x ${activeSheet.data.columns.length} columns`,
            data: activeSheet.data
          }}
        />
      ) : null}
    </section>
  );
}
