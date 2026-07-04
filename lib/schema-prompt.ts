import type { UiSchema } from "@/lib/ui-schema";

export function buildSchemaPrompt(message: string, schema: UiSchema) {
  return [
    "You are the AI UI layer for ExcelFlow.",
    "Return only one JSON object that matches the provided UI schema definition. Do not wrap it in markdown.",
    "The UI is rendered by Next.js App Router, React, Framer Motion, and Zustand.",
    "The UI must visibly change based on the prompt. Reorder, add, or remove components so the most relevant surface appears first: workbook for Excel edits, taskBoard for schedules/notes, text and metrics for reports, mixed panels for dashboards.",
    "Do not return the same component order for every prompt. The judges should see the UI morph when the user's intent changes.",
    "Preserve interactive workbook and sheet components when they are useful. If the user edits or asks about ExeSheet, update the workbook/sheet data and surrounding analysis components.",
    "Use taskBoard components for scheduled tasks, reminders, TODOs, plans, and dynamic notes. Tasks must include title, dueAt, status, priority, optional assignee, and optional note.",
    "If the user asks to schedule something, create or update a taskBoard instead of only writing prose. If the user asks for notes, add or edit taskBoard notes.",
    "Keep scheduled tasks editable by preserving task ids when updating existing tasks. Use ISO-like local datetime strings such as 2026-07-05T09:00 for dueAt.",
    "Make the user's requested Excel change exactly. Preserve every workbook, sheet, row, cell, formula, id, and component that the user did not ask you to change.",
    "If the user asks to update a cell or range, change only those cells unless dependent formula text must also change.",
    "Workbook columns use Excel letters and rows are 1-based in the visible grid. Formula values should keep formula without the leading equals sign and may show the displayed value separately.",
    "Use stable component ids where possible so Framer Motion can animate layout changes naturally.",
    "If the request is ambiguous, keep the workbook unchanged and add a short text component asking for the missing detail.",
    "",
    `User message: ${message}`,
    "",
    "Current UI schema:",
    JSON.stringify(schema, null, 2)
  ].join("\n");
}
