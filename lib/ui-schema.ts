import { z } from "zod";

export const cellSchema = z.object({
  id: z.string(),
  value: z.string(),
  formula: z.string().optional()
});

export const sheetRowSchema = z.object({
  id: z.string(),
  cells: z.array(cellSchema)
});

export const sheetDataSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(sheetRowSchema)
});

export const workbookSheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  data: sheetDataSchema
});

export const taskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueAt: z.string(),
  status: z.enum(["todo", "doing", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  assignee: z.string().optional(),
  note: z.string().optional()
});

export const taskNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  linkedTaskId: z.string().optional()
});

export const uiComponentSchema: z.ZodType<UiComponent, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      id: z.string(),
      type: z.literal("hero"),
      title: z.string(),
      subtitle: z.string(),
      action: z.string().optional()
    }),
    z.object({
      id: z.string(),
      type: z.literal("metric"),
      label: z.string(),
      value: z.string(),
      tone: z.enum(["neutral", "good", "warn", "bad"]).default("neutral"),
      detail: z.string().optional()
    }),
    z.object({
      id: z.string(),
      type: z.literal("text"),
      title: z.string().optional(),
      body: z.string()
    }),
    z.object({
      id: z.string(),
      type: z.literal("sheet"),
      title: z.string(),
      description: z.string().optional(),
      data: sheetDataSchema
    }),
    z.object({
      id: z.string(),
      type: z.literal("workbook"),
      title: z.string(),
      fileName: z.string().optional(),
      activeSheetId: z.string(),
      sheets: z.array(workbookSheetSchema)
    }),
    z.object({
      id: z.string(),
      type: z.literal("taskBoard"),
      title: z.string(),
      summary: z.string().optional(),
      tasks: z.array(taskItemSchema),
      notes: z.array(taskNoteSchema)
    }),
    z.object({
      id: z.string(),
      type: z.literal("section"),
      title: z.string(),
      children: z.array(uiComponentSchema)
    })
  ])
);

export const uiSchema = z.object({
  version: z.literal(1),
  intent: z.string(),
  layout: z.enum(["workspace", "analysis", "report"]).default("workspace"),
  components: z.array(uiComponentSchema),
  updatedAt: z.string()
});

export type Cell = z.infer<typeof cellSchema>;
export type SheetRow = z.infer<typeof sheetRowSchema>;
export type SheetData = z.infer<typeof sheetDataSchema>;
export type WorkbookSheet = z.infer<typeof workbookSheetSchema>;
export type TaskItem = z.infer<typeof taskItemSchema>;
export type TaskNote = z.infer<typeof taskNoteSchema>;
export type UiSchema = z.infer<typeof uiSchema>;

export type UiComponent =
  | {
      id: string;
      type: "hero";
      title: string;
      subtitle: string;
      action?: string;
    }
  | {
      id: string;
      type: "metric";
      label: string;
      value: string;
      tone: "neutral" | "good" | "warn" | "bad";
      detail?: string;
    }
  | {
      id: string;
      type: "text";
      title?: string;
      body: string;
    }
  | {
      id: string;
      type: "sheet";
      title: string;
      description?: string;
      data: SheetData;
    }
  | {
      id: string;
      type: "workbook";
      title: string;
      fileName?: string;
      activeSheetId: string;
      sheets: WorkbookSheet[];
    }
  | {
      id: string;
      type: "taskBoard";
      title: string;
      summary?: string;
      tasks: TaskItem[];
      notes: TaskNote[];
    }
  | {
      id: string;
      type: "section";
      title: string;
      children: UiComponent[];
    };

export const defaultSchema: UiSchema = {
  version: 1,
  intent: "Model a revenue sheet and ask Claude to reshape the interface.",
  layout: "workspace",
  updatedAt: new Date(0).toISOString(),
  components: [
    {
      id: "hero-start",
      type: "hero",
      title: "ExcelFlow",
      subtitle:
        "A live UI renderer where Claude returns structured schema and the sheet stays interactive inside the experience.",
      action: "Ask Claude to transform this workspace"
    },
    {
      id: "workbook-core",
      type: "workbook",
      title: "ExeSheet Workbook",
      fileName: "excelflow-demo.xlsx",
      activeSheetId: "demo-q1",
      sheets: [
        {
          id: "demo-q1",
          name: "Q1 Model",
          data: {
            columns: ["A", "B", "C", "D"],
            rows: [
              {
                id: "row-1",
                cells: [
                  { id: "a1", value: "Month" },
                  { id: "b1", value: "Revenue" },
                  { id: "c1", value: "Cost" },
                  { id: "d1", value: "Margin" }
                ]
              },
              {
                id: "row-2",
                cells: [
                  { id: "a2", value: "January" },
                  { id: "b2", value: "24500" },
                  { id: "c2", value: "13200" },
                  { id: "d2", value: "11300", formula: "B2-C2" }
                ]
              },
              {
                id: "row-3",
                cells: [
                  { id: "a3", value: "February" },
                  { id: "b3", value: "27100" },
                  { id: "c3", value: "14150" },
                  { id: "d3", value: "12950", formula: "B3-C3" }
                ]
              },
              {
                id: "row-4",
                cells: [
                  { id: "a4", value: "March" },
                  { id: "b4", value: "30200" },
                  { id: "c4", value: "15750" },
                  { id: "d4", value: "14450", formula: "B4-C4" }
                ]
              }
            ]
          }
        }
      ]
    },
    {
      id: "metric-margin",
      type: "metric",
      label: "Q1 Margin",
      value: "$38.7k",
      tone: "good",
      detail: "Calculated from the editable ExeSheet rows."
    },
    {
      id: "task-board-core",
      type: "taskBoard",
      title: "Scheduled Tasks",
      summary:
        "Prompt Claude to schedule work, then edit tasks and notes directly in this panel.",
      tasks: [
        {
          id: "task-review-model",
          title: "Review workbook assumptions",
          dueAt: "2026-07-05T09:00",
          status: "todo",
          priority: "high",
          assignee: "User",
          note: "Confirm the imported workbook inputs before exporting results."
        }
      ],
      notes: [
        {
          id: "note-prompt-driven",
          title: "Dynamic prompt notes",
          body:
            "Notes can be generated from prompts and edited here. Ask Claude to add, rewrite, or link notes to scheduled tasks."
        }
      ]
    }
  ]
};

export function getAllSheets(schema: UiSchema): SheetData[] {
  const sheets: SheetData[] = [];

  function visit(component: UiComponent) {
    if (component.type === "sheet") {
      sheets.push(component.data);
    }

    if (component.type === "workbook") {
      component.sheets.forEach((sheet) => sheets.push(sheet.data));
    }

    if (component.type === "section") {
      component.children.forEach(visit);
    }
  }

  schema.components.forEach(visit);
  return sheets;
}
