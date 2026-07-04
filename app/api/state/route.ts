import { z } from "zod";
import { readUiDatabase, writeUiDatabase } from "@/lib/ui-database";
import { uiSchema } from "@/lib/ui-schema";

export const runtime = "nodejs";

const saveRequestSchema = z.object({
  schema: uiSchema,
  message: z.string().default("Manual UI update"),
  source: z.enum(["prompt", "manual", "import", "reset"]).default("manual")
});

export async function GET() {
  const database = await readUiDatabase();
  return Response.json(database);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = saveRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Expected a valid UI schema." }, { status: 400 });
  }

  const database = await writeUiDatabase(parsed.data.schema, {
    message: parsed.data.message,
    source: parsed.data.source
  });

  return Response.json(database);
}
