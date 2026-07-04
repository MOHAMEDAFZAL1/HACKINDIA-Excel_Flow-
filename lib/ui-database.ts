import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { defaultSchema, uiSchema, type UiSchema } from "@/lib/ui-schema";

type UiDatabase = {
  schema: UiSchema;
  history: Array<{
    id: string;
    message: string;
    source: "prompt" | "manual" | "import" | "reset";
    updatedAt: string;
  }>;
};

const databasePath = path.join(process.cwd(), "data", "ui-state.json");

export async function readUiDatabase(): Promise<UiDatabase> {
  try {
    const raw = await readFile(databasePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<UiDatabase>;
    const schema = uiSchema.safeParse(parsed.schema);

    return {
      schema: schema.success ? schema.data : defaultSchema,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-50) : []
    };
  } catch {
    return {
      schema: defaultSchema,
      history: []
    };
  }
}

export async function writeUiDatabase(
  schema: UiSchema,
  event: { message: string; source: UiDatabase["history"][number]["source"] }
) {
  console.log("[ui-database] writeUiDatabase called:", {
    intent: schema.intent,
    message: event.message,
    source: event.source,
    componentCount: schema.components.length,
    path: databasePath
  });

  const current = await readUiDatabase();
  const updatedAt = new Date().toISOString();
  const database: UiDatabase = {
    schema: {
      ...schema,
      updatedAt
    },
    history: [
      ...current.history,
      {
        id: `event-${Date.now()}`,
        message: event.message,
        source: event.source,
        updatedAt
      }
    ].slice(-50)
  };

  await mkdir(path.dirname(databasePath), { recursive: true });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await writeFile(databasePath, JSON.stringify(database, null, 2), "utf8");
      console.log("[ui-database] Write succeeded on attempt", attempt, "history length:", database.history.length);
      return database;
    } catch (writeError) {
      console.error("[ui-database] Write attempt", attempt, "failed:", writeError);
      if (attempt === 3) {
        throw writeError;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }

  return database;
}
