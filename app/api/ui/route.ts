import { z } from "zod";
import { buildSchemaPrompt } from "@/lib/schema-prompt";
import { writeUiDatabase } from "@/lib/ui-database";
import { defaultSchema, uiSchema, type UiComponent, type UiSchema } from "@/lib/ui-schema";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1),
  schema: uiSchema
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: "Expected a message and the current UI schema." },
      { status: 400 }
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return streamMockSchema(parsed.data.message, parsed.data.schema);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const dynamicPreviewSchema = buildDynamicUiSchema(
          parsed.data.message,
          parsed.data.schema
        );

        console.log("[api/ui] Sending partial schema for:", parsed.data.message);
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "partial",
              schema: dynamicPreviewSchema
            })}\n`
          )
        );

        const localSchema = buildLocalFirstSchema(
          parsed.data.message,
          dynamicPreviewSchema
        );

        if (localSchema) {
          console.log("[api/ui] Local-first schema resolved, writing to database");
          try {
            await writeUiDatabase(localSchema, {
              message: parsed.data.message,
              source: "prompt"
            });
          } catch (dbError) {
            console.error("[api/ui] Database write failed for local schema:", dbError);
          }
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ type: "final", schema: localSchema })}\n`)
          );
          return;
        }

        console.log("[api/ui] No local schema, calling OpenRouter");
        const finalSchema = await callOpenRouter(
          apiKey,
          parsed.data.message,
          dynamicPreviewSchema
        ).catch((error) => {
          console.error("[api/ui] OpenRouter failed, using fallback:", error instanceof Error ? error.message : error);
          if (isTaskPrompt(parsed.data.message)) {
            return buildLocalTaskSchema(parsed.data.message, dynamicPreviewSchema);
          }

          if (isExcelPrompt(parsed.data.message)) {
            return buildLocalExcelSchema(parsed.data.message, dynamicPreviewSchema);
          }

          return buildProviderFallbackSchema(
            parsed.data.message,
            dynamicPreviewSchema,
            error
          );
        });

        console.log("[api/ui] Final schema ready, writing to database");
        try {
          await writeUiDatabase(finalSchema, {
            message: parsed.data.message,
            source: "prompt"
          });
        } catch (dbError) {
          console.error("[api/ui] Database write failed for final schema:", dbError);
        }
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: "final", schema: finalSchema })}\n`)
        );
      } catch (error) {
        console.error("[api/ui] Stream handler error:", error);
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "OpenRouter Claude call failed."
            })}\n`
          )
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}

async function callOpenRouter(
  apiKey: string,
  message: string,
  currentSchema: UiSchema
): Promise<UiSchema> {
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5";
  const maxTokens = Number(process.env.OPENROUTER_MAX_TOKENS ?? 700);
  const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 25000);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "ExcelFlow"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Claude controlling an Excel-like UI through JSON schema. Return valid JSON only. Preserve workbook data unless the user explicitly asks to change it."
        },
        {
          role: "user",
          content: buildSchemaPrompt(message, currentSchema)
        }
      ]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`OpenRouter error ${response.status}: ${responseText}`);
  }

  const completion = JSON.parse(responseText) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = completion.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter returned an empty Claude response.");
  }

  const jsonText = extractJsonObject(content);
  const parsedJson = JSON.parse(jsonText);
  const parsedSchema = uiSchema.safeParse(normalizeAiSchema(parsedJson));

  if (!parsedSchema.success) {
    throw new Error(
      `Claude returned JSON, but it did not match the ExcelFlow schema: ${parsedSchema.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }

  return {
    ...parsedSchema.data,
    updatedAt: new Date().toISOString()
  };
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedJson?.[1]) {
    return fencedJson[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Claude did not return a JSON object.");
}

function normalizeAiSchema(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const components = Array.isArray(value.components)
    ? value.components.map(normalizeComponent)
    : [];

  return {
    ...value,
    version: 1,
    layout: normalizeLayout(value.layout),
    intent: typeof value.intent === "string" ? value.intent : "Generated UI update",
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    components
  };
}

function normalizeComponent(component: unknown): unknown {
  if (!isRecord(component)) {
    return component;
  }

  if (component.type === "hero") {
    const {
      action: _action,
      title: _title,
      subtitle: _subtitle,
      ...rest
    } = component;

    return {
      ...rest,
      id: stringOr(component.id, "dynamic-hero"),
      title: stringOr(component.title, "ExcelFlow"),
      subtitle: stringOr(component.subtitle, ""),
      ...(typeof component.action === "string" ? { action: component.action } : {})
    };
  }

  if (component.type === "metric") {
    const {
      detail: _detail,
      tone: _tone,
      label: _label,
      value: _value,
      ...rest
    } = component;

    return {
      ...rest,
      id: stringOr(component.id, "dynamic-metric"),
      label: stringOr(component.label, "Metric"),
      value: stringOr(component.value, ""),
      tone: normalizeTone(stringOr(component.tone, "neutral")),
      ...(typeof component.detail === "string" ? { detail: component.detail } : {})
    };
  }

  if (component.type === "text") {
    const { title: _title, body: _body, ...rest } = component;

    return {
      ...rest,
      id: stringOr(component.id, "dynamic-text"),
      body: stringOr(component.body, ""),
      ...(typeof component.title === "string" ? { title: component.title } : {})
    };
  }

  if (component.type === "workbook") {
    const {
      fileName: _fileName,
      title: _title,
      activeSheetId: _activeSheetId,
      sheets: _sheets,
      ...rest
    } = component;

    return {
      ...rest,
      id: stringOr(component.id, "workbook-core"),
      title: stringOr(component.title, "ExeSheet Workbook"),
      activeSheetId: stringOr(component.activeSheetId, "sheet-1"),
      ...(typeof component.fileName === "string" ? { fileName: component.fileName } : {}),
      sheets: Array.isArray(component.sheets) ? component.sheets : []
    };
  }

  if (component.type === "taskBoard") {
    const tasks = Array.isArray(component.tasks)
      ? component.tasks.map((task, index) => normalizeTask(task, index))
      : [];
    const notes = Array.isArray(component.notes)
      ? component.notes.map((note, index) => normalizeNote(note, index))
      : [];

    return {
      ...component,
      id: stringOr(component.id, "task-board-generated"),
      title: stringOr(component.title, "Scheduled Tasks"),
      tasks,
      notes
    };
  }

  if (component.type === "section") {
    return {
      ...component,
      children: Array.isArray(component.children)
        ? component.children.map(normalizeComponent)
        : []
    };
  }

  return component;
}

function normalizeTask(task: unknown, index: number) {
  const record = isRecord(task) ? task : {};
  const {
    assignee: _assignee,
    note: _note,
    description: _description,
    ...rest
  } = record;
  const title = stringOr(record.title, `Task ${index + 1}`);
  const rawStatus = stringOr(record.status, "todo").toLowerCase();
  const rawPriority = stringOr(record.priority, "medium").toLowerCase();

  return {
    ...rest,
    id: stringOr(record.id, `task-${index + 1}`),
    title,
    dueAt: stringOr(record.dueAt ?? record.dueDate ?? record.date, localDateTime()),
    status: normalizeStatus(rawStatus),
    priority: normalizePriority(rawPriority),
    ...(typeof record.assignee === "string" ? { assignee: record.assignee } : {}),
    note:
      typeof record.note === "string"
        ? record.note
        : typeof record.description === "string"
          ? record.description
          : undefined
  };
}

function normalizeNote(note: unknown, index: number) {
  const record = isRecord(note) ? note : {};

  return {
    ...record,
    id: stringOr(record.id, `note-${index + 1}`),
    title: stringOr(record.title, `Note ${index + 1}`),
    body: stringOr(record.body ?? record.content ?? record.note, "")
  };
}

function normalizeStatus(value: string) {
  if (["doing", "in_progress", "in-progress", "active", "started"].includes(value)) {
    return "doing";
  }

  if (["done", "complete", "completed", "finished"].includes(value)) {
    return "done";
  }

  return "todo";
}

function normalizePriority(value: string) {
  if (["high", "urgent", "critical"].includes(value)) {
    return "high";
  }

  if (["low", "minor"].includes(value)) {
    return "low";
  }

  return "medium";
}

function normalizeTone(value: string) {
  const normalized = value.toLowerCase();

  if (["good", "positive", "success", "up"].includes(normalized)) {
    return "good";
  }

  if (["warn", "warning", "caution"].includes(normalized)) {
    return "warn";
  }

  if (["bad", "negative", "danger", "down", "error"].includes(normalized)) {
    return "bad";
  }

  return "neutral";
}

function normalizeLayout(value: unknown) {
  return value === "analysis" || value === "report" || value === "workspace"
    ? value
    : "workspace";
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localDateTime() {
  return new Date().toISOString().slice(0, 16);
}

function buildDynamicUiSchema(message: string, currentSchema: UiSchema): UiSchema {
  const intent = getPromptIntent(message);
  const workbook = findWorkbook(currentSchema);
  const taskBoard = findTaskBoard(currentSchema);
  const components: UiComponent[] = [];

  components.push(buildIntentHero(message, intent));

  if (intent === "excel") {
    components.push({
      id: "dynamic-excel-status",
      type: "metric",
      label: "Mode",
      value: "Excel Edit",
      tone: "good",
      detail: "Workbook controls move to the front because your prompt targets sheet data."
    });

    if (workbook) {
      components.push(workbook);
    }

    components.push({
      id: "dynamic-excel-note",
      type: "text",
      title: "Prompt Action",
      body:
        "The workbook is now the primary surface. Simple row, column, and table edits can run instantly, with Claude handling broader transformations when credits are available."
    });

    if (taskBoard) {
      components.push(taskBoard);
    }
  } else if (intent === "task") {
    components.push(
      taskBoard ?? {
        id: "task-board-core",
        type: "taskBoard",
        title: "Scheduled Tasks",
        summary: "Prompt-generated schedule. Edit tasks and notes directly here.",
        tasks: [],
        notes: []
      }
    );

    components.push({
      id: "dynamic-task-status",
      type: "metric",
      label: "Mode",
      value: "Scheduler",
      tone: "neutral",
      detail: "The task board is promoted because your prompt is about schedule or notes."
    });

    if (workbook) {
      components.push(workbook);
    }
  } else if (intent === "report") {
    components.push({
      id: "dynamic-report-summary",
      type: "text",
      title: "Report View",
      body:
        "The UI has shifted into a narrative report layout. Claude can add written findings, preserve the workbook, and keep scheduled follow-ups editable."
    });
    components.push({
      id: "dynamic-report-metric",
      type: "metric",
      label: "Layout",
      value: "Report",
      tone: "neutral",
      detail: "Text and summary components are prioritized for presentation."
    });

    if (workbook) {
      components.push(workbook);
    }

    if (taskBoard) {
      components.push(taskBoard);
    }
  } else {
    components.push({
      id: "dynamic-dashboard-metric",
      type: "metric",
      label: "Dynamic UI",
      value: "Active",
      tone: "good",
      detail: "The component order and layout are being chosen from the prompt."
    });
    components.push({
      id: "dynamic-dashboard-note",
      type: "text",
      title: "Workspace Update",
      body:
        "This view keeps the workbook, task board, and summary panels available while Claude decides the final shape."
    });

    if (workbook) {
      components.push(workbook);
    }

    if (taskBoard) {
      components.push(taskBoard);
    }
  }

  const knownIds = new Set(components.map((component) => component.id));
  for (const component of currentSchema.components) {
    if (!knownIds.has(component.id) && component.type !== "hero") {
      components.push(component);
      knownIds.add(component.id);
    }
  }

  return {
    ...currentSchema,
    intent: message,
    layout: intent === "report" ? "report" : intent === "dashboard" ? "analysis" : "workspace",
    updatedAt: new Date().toISOString(),
    components
  };
}

function getPromptIntent(message: string) {
  if (isTaskPrompt(message)) {
    return "task";
  }

  if (isExcelPrompt(message)) {
    return "excel";
  }

  if (/\b(report|summary|writeup|presentation|explain|narrative)\b/i.test(message)) {
    return "report";
  }

  return "dashboard";
}

function buildIntentHero(message: string, intent: string): UiComponent {
  const titleByIntent: Record<string, string> = {
    excel: "Excel Edit Mode",
    task: "Schedule Mode",
    report: "Report Mode",
    dashboard: "Dynamic Workspace"
  };
  const subtitleByIntent: Record<string, string> = {
    excel: "The workbook moves to the front because your prompt changes sheet structure or values.",
    task: "The task board moves to the front because your prompt schedules work or creates notes.",
    report: "The UI becomes a report surface for written findings and supporting workbook data.",
    dashboard: "The UI rearranges itself around the prompt while keeping workbook and task state editable."
  };

  return {
    id: "dynamic-hero",
    type: "hero",
    title: titleByIntent[intent] ?? "Dynamic Workspace",
    subtitle: subtitleByIntent[intent] ?? subtitleByIntent.dashboard,
    action: message.slice(0, 90)
  };
}

function findWorkbook(schema: UiSchema) {
  return schema.components.find((component) => component.type === "workbook");
}

function isExcelPrompt(message: string) {
  return /\b(excel|sheet|workbook|table|column|row|cell|formula|count|sum|total)\b/i.test(
    message
  );
}

function buildLocalFirstSchema(message: string, currentSchema: UiSchema) {
  if (isDirectExcelEditPrompt(message)) {
    return buildLocalExcelSchema(message, currentSchema);
  }

  if (isTaskPrompt(message)) {
    return buildLocalTaskSchema(message, currentSchema);
  }

  return undefined;
}

function buildProviderFallbackSchema(
  message: string,
  currentSchema: UiSchema,
  error?: unknown
): UiSchema {
  const reason = error instanceof Error ? error.message : "Unknown provider issue.";

  return {
    ...currentSchema,
    intent: message,
    updatedAt: new Date().toISOString(),
    components: [
      ...currentSchema.components,
      {
        id: "dynamic-provider-fallback",
        type: "text",
        title: "AI Provider Fallback",
        body:
          `The UI still changed locally. OpenRouter/Claude Haiku could not produce a valid schema, so this response used the prompt-driven local schema instead. Reason: ${reason.slice(0, 260)}`
      }
    ]
  };
}

function isDirectExcelEditPrompt(message: string) {
  const lowerMessage = message.toLowerCase();

  return (
    /\b(add|create|insert|make|delete|remove|rename|update|change)\b/.test(
      lowerMessage
    ) &&
    /\b(column|row|table|cell|count|sum|total)\b/.test(lowerMessage)
  );
}

function buildLocalExcelSchema(message: string, currentSchema: UiSchema): UiSchema {
  const lowerMessage = message.toLowerCase();

  if (/\b(create|make|add)\b/.test(lowerMessage) && /\btable\b/.test(lowerMessage)) {
    return replaceActiveWorkbookSheet(currentSchema, buildPromptTable(message));
  }

  if (/\b(add|create|insert)\b/.test(lowerMessage) && /\bcolumn\b/.test(lowerMessage)) {
    return updateActiveWorkbookSheet(currentSchema, (sheet) =>
      addColumnToSheet(sheet, inferColumnLabel(message))
    );
  }

  if (/\b(add|create|insert)\b/.test(lowerMessage) && /\brow\b/.test(lowerMessage)) {
    return updateActiveWorkbookSheet(currentSchema, addRowToSheet);
  }

  return currentSchema;
}

function replaceActiveWorkbookSheet(schema: UiSchema, nextSheet: WorkbookSheet) {
  return {
    ...schema,
    updatedAt: new Date().toISOString(),
    components: schema.components.map((component) => {
      if (component.type !== "workbook") {
        return component;
      }

      const activeSheetId = component.activeSheetId || component.sheets[0]?.id;
      return {
        ...component,
        sheets: component.sheets.map((sheet) =>
          sheet.id === activeSheetId ? nextSheet : sheet
        )
      };
    })
  };
}

function updateActiveWorkbookSheet(
  schema: UiSchema,
  updater: (sheet: WorkbookSheet) => WorkbookSheet
) {
  return {
    ...schema,
    updatedAt: new Date().toISOString(),
    components: schema.components.map((component) => {
      if (component.type !== "workbook") {
        return component;
      }

      const activeSheetId = component.activeSheetId || component.sheets[0]?.id;
      return {
        ...component,
        sheets: component.sheets.map((sheet) =>
          sheet.id === activeSheetId ? updater(sheet) : sheet
        )
      };
    })
  };
}

type WorkbookComponent = Extract<UiSchema["components"][number], { type: "workbook" }>;
type WorkbookSheet = WorkbookComponent["sheets"][number];

function addColumnToSheet(sheet: WorkbookSheet, label: string): WorkbookSheet {
  const nextColumn = nextColumnName(sheet.data.columns);
  const hasHeaderRow = sheet.data.rows.length > 0;

  return {
    ...sheet,
    data: {
      columns: [...sheet.data.columns, nextColumn],
      rows: sheet.data.rows.map((row, rowIndex) => ({
        ...row,
        cells: [
          ...row.cells,
          {
            id: `${row.id}-${nextColumn.toLowerCase()}`,
            value:
              rowIndex === 0 && hasHeaderRow
                ? label
                : label.toLowerCase() === "count"
                  ? String(rowIndex)
                  : ""
          }
        ]
      }))
    }
  };
}

function addRowToSheet(sheet: WorkbookSheet): WorkbookSheet {
  const nextRowNumber = sheet.data.rows.length + 1;

  return {
    ...sheet,
    data: {
      ...sheet.data,
      rows: [
        ...sheet.data.rows,
        {
          id: `row-${nextRowNumber}`,
          cells: sheet.data.columns.map((column) => ({
            id: `${column.toLowerCase()}${nextRowNumber}`,
            value: ""
          }))
        }
      ]
    }
  };
}

function buildPromptTable(message: string): WorkbookSheet {
  const tableName = inferTableName(message);
  const isStudentTable = tableName.toLowerCase().includes("student");
  const headers = isStudentTable
    ? ["Student ID", "Name", "Class", "Count"]
    : ["Name", "Description", "Count"];
  const rows = [
    headers,
    isStudentTable ? ["S-001", "Student 1", "A", "1"] : ["Item 1", "", "1"],
    isStudentTable ? ["S-002", "Student 2", "B", "2"] : ["Item 2", "", "2"]
  ];

  return {
    id: "generated-table",
    name: titleCase(tableName),
    data: {
      columns: rows[0].map((_, index) => nextColumnNameForIndex(index)),
      rows: rows.map((values, rowIndex) => ({
        id: `row-${rowIndex + 1}`,
        cells: values.map((value, columnIndex) => ({
          id: `${nextColumnNameForIndex(columnIndex).toLowerCase()}${rowIndex + 1}`,
          value
        }))
      }))
    }
  };
}

function inferTableName(message: string) {
  const match =
    message.match(/\b(?:table|called|named)\s+["']?([a-z0-9 _-]+)["']?/i) ??
    message.match(/\bcreate\s+["']?([a-z0-9 _-]+)["']?\s+table/i);
  const rawName = match?.[1]?.replace(/\b(with|and|as|for|to)\b.*$/i, "").trim();

  return rawName || "generated table";
}

function nextColumnNameForIndex(index: number) {
  let number = index + 1;
  let name = "";

  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }

  return name;
}

function inferColumnLabel(message: string) {
  const match =
    message.match(/\b(?:as|called|named)\s+["']?([a-z0-9 _-]+)["']?/i) ??
    message.match(/\bcolumn\s+["']?([a-z0-9 _-]+)["']?/i);
  const rawLabel = match?.[1]?.replace(/\b(to|in|on|for|with)\b.*$/i, "").trim();

  return rawLabel ? titleCase(rawLabel) : "New Column";
}

function nextColumnName(columns: string[]) {
  const lastColumn = columns.at(-1);

  if (!lastColumn || !/^[A-Z]+$/.test(lastColumn)) {
    return `Column ${columns.length + 1}`;
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

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function isTaskPrompt(message: string) {
  return /\b(schedule|task|todo|to-do|remind|reminder|note|checklist|plan)\b/i.test(
    message
  );
}

function buildLocalTaskSchema(message: string, currentSchema: UiSchema): UiSchema {
  const taskBoard = findTaskBoard(currentSchema) ?? {
    id: "task-board-core",
    type: "taskBoard" as const,
    title: "Scheduled Tasks",
    summary: "Editable scheduled tasks and notes.",
    tasks: [],
    notes: []
  };
  const now = new Date();
  const dueAt = inferDueAt(message, now);
  const taskId = `task-${Date.now()}`;
  const noteId = `note-${Date.now()}`;
  const title = inferTaskTitle(message);
  const checklist = inferChecklist(message);
  const nextTaskBoard = {
    ...taskBoard,
    summary: "Generated from your prompt. You can edit every task and note here.",
    tasks: [
      ...taskBoard.tasks,
      {
        id: taskId,
        title,
        dueAt,
        status: "todo" as const,
        priority: inferPriority(message),
        assignee: "User",
        note: checklist
      }
    ],
    notes: [
      ...taskBoard.notes,
      {
        id: noteId,
        title: `${title} checklist`,
        body: checklist,
        linkedTaskId: taskId
      }
    ]
  };
  const hadTaskBoard = currentSchema.components.some(
    (component) => component.type === "taskBoard"
  );

  return {
    ...currentSchema,
    intent: message,
    updatedAt: new Date().toISOString(),
    components: hadTaskBoard
      ? currentSchema.components.map((component) =>
          component.type === "taskBoard" ? nextTaskBoard : component
        )
      : [...currentSchema.components, nextTaskBoard]
  };
}

function findTaskBoard(schema: UiSchema) {
  for (const component of schema.components) {
    if (component.type === "taskBoard") {
      return component;
    }
  }

  return undefined;
}

function inferDueAt(message: string, now: Date) {
  const due = new Date(now);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("tomorrow")) {
    due.setDate(due.getDate() + 1);
  }

  const timeMatch = lowerMessage.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? 0);
    const meridiem = timeMatch[3];

    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    }

    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }

    due.setHours(hour, minute, 0, 0);
  } else {
    due.setHours(9, 0, 0, 0);
  }

  return localDateTimeFromDate(due);
}

function localDateTimeFromDate(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function inferPriority(message: string) {
  if (/\b(high|urgent|important|critical)\b/i.test(message)) {
    return "high" as const;
  }

  if (/\b(low|minor)\b/i.test(message)) {
    return "low" as const;
  }

  return "medium" as const;
}

function inferTaskTitle(message: string) {
  const cleaned = message
    .replace(/\b(schedule|create|add|make|a|an|the|task|todo|to-do|reminder)\b/gi, " ")
    .replace(/\b(high|medium|low|priority|tomorrow|today|at|am|pm)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned ? sentenceCase(cleaned.slice(0, 80)) : "Scheduled task";
}

function inferChecklist(message: string) {
  if (/\bchecklist\b/i.test(message)) {
    return [
      "Review the relevant workbook or table.",
      "Confirm required fields and formulas.",
      "Update the Excel UI and export the final workbook."
    ].join("\n");
  }

  return `Prompt note: ${message}`;
}

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function streamMockSchema(message: string, currentSchema: UiSchema) {
  const encoder = new TextEncoder();
  const mockSchema: UiSchema = {
    ...currentSchema,
    intent: message,
    layout: message.toLowerCase().includes("report") ? "report" : "analysis",
    updatedAt: new Date().toISOString(),
    components: [
      {
        id: "hero-start",
        type: "hero",
        title: "ExcelFlow",
        subtitle:
          "Add OPENROUTER_API_KEY to .env.local to let Claude make exact Excel changes from your prompt.",
        action: "Streaming schema preview"
      },
      ...currentSchema.components.filter(
        (component) =>
          component.type === "sheet" ||
          component.type === "workbook" ||
          component.type === "taskBoard"
      ),
      {
        id: "metric-ai-status",
        type: "metric",
        label: "AI Route",
        value: "Ready",
        tone: "warn",
        detail: "The App Router API is live. Claude is waiting for credentials."
      },
      {
        id: "text-ai-summary",
        type: "text",
        title: "Requested change",
        body: `Claude will receive the full Zustand schema and ExeSheet data for: "${message}".`
      }
    ]
  };

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`${JSON.stringify({ type: "partial", schema: defaultSchema })}\n`)
      );
      controller.enqueue(
        encoder.encode(`${JSON.stringify({ type: "final", schema: mockSchema })}\n`)
      );
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}
