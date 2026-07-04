"use client";

import { create } from "zustand";
import {
  defaultSchema,
  type SheetData,
  type UiComponent,
  type UiSchema
} from "@/lib/ui-schema";

type WorkbookComponent = Extract<UiComponent, { type: "workbook" }>;
type TaskBoardComponent = Extract<UiComponent, { type: "taskBoard" }>;

type UiStore = {
  prompt: string;
  schema: UiSchema;
  isStreaming: boolean;
  error: string | null;
  setPrompt: (prompt: string) => void;
  setSchema: (schema: UiSchema) => void;
  setStreaming: (isStreaming: boolean) => void;
  setError: (error: string | null) => void;
  upsertWorkbook: (component: WorkbookComponent) => void;
  updateSheet: (componentId: string, data: SheetData, sheetId?: string) => void;
  setActiveWorkbookSheet: (componentId: string, sheetId: string) => void;
  updateTaskBoard: (componentId: string, component: TaskBoardComponent) => void;
};

export const useUiStore = create<UiStore>((set) => ({
  prompt: "",
  schema: defaultSchema,
  isStreaming: false,
  error: null,
  setPrompt: (prompt) => set({ prompt }),
  setSchema: (schema) => set({ schema, error: null }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setError: (error) => set({ error }),
  upsertWorkbook: (workbook) =>
    set((state) => {
      const hasWorkbook = state.schema.components.some(
        (component) => component.type === "workbook"
      );
      const components = hasWorkbook
        ? state.schema.components.map((component) =>
            component.type === "workbook" ? workbook : component
          )
        : [
            ...state.schema.components.filter((component) => component.type !== "sheet"),
            workbook
          ];

      return {
        schema: {
          ...state.schema,
          intent: `Connected workbook: ${workbook.fileName ?? workbook.title}`,
          updatedAt: new Date().toISOString(),
          components
        },
        error: null
      };
    }),
  updateSheet: (componentId, data, sheetId) =>
    set((state) => ({
      schema: {
        ...state.schema,
        updatedAt: new Date().toISOString(),
        components: mapComponents(state.schema.components, (component) => {
          if (component.id === componentId && component.type === "sheet") {
            return { ...component, data };
          }

          if (component.type === "workbook") {
            const isTargetWorkbook = component.id === componentId;
            const sheets = component.sheets.map((sheet) => {
              const matchesSheet =
                (isTargetWorkbook && sheetId === sheet.id) || componentId === sheet.id;

              return matchesSheet ? { ...sheet, data } : sheet;
            });

            return { ...component, sheets };
          }

          return component;
        })
      }
    })),
  setActiveWorkbookSheet: (componentId, sheetId) =>
    set((state) => ({
      schema: {
        ...state.schema,
        updatedAt: new Date().toISOString(),
        components: mapComponents(state.schema.components, (component) =>
          component.id === componentId && component.type === "workbook"
            ? { ...component, activeSheetId: sheetId }
            : component
        )
      }
    })),
  updateTaskBoard: (componentId, taskBoard) =>
    set((state) => ({
      schema: {
        ...state.schema,
        updatedAt: new Date().toISOString(),
        components: mapComponents(state.schema.components, (component) =>
          component.id === componentId && component.type === "taskBoard"
            ? { ...taskBoard, id: componentId }
            : component
        )
      },
      error: null
    }))
}));

function mapComponents(
  components: UiComponent[],
  mapper: (component: UiComponent) => UiComponent
): UiComponent[] {
  return components.map((component) => {
    const nested =
      component.type === "section"
        ? { ...component, children: mapComponents(component.children, mapper) }
        : component;

    return mapper(nested);
  });
}
