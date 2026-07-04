"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import { SchemaRenderer } from "@/components/schema-renderer";
import { defaultSchema, getAllSheets, uiSchema } from "@/lib/ui-schema";
import { useUiStore } from "@/store/ui-store";

type StreamEvent =
  | { type: "partial" | "final"; schema: unknown }
  | { type: "error"; error: string };

export function Workspace() {
  const [databaseStatus, setDatabaseStatus] = useState<"loading" | "saved" | "error">(
    "loading"
  );
  const didLoadDatabase = useRef(false);
  const skipNextAutosave = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    prompt,
    schema,
    isStreaming,
    error,
    setPrompt,
    setSchema,
    setStreaming,
    setError
  } = useUiStore();

  const sheetCount = useMemo(() => getAllSheets(schema).length, [schema]);

  useEffect(() => {
    let isMounted = true;

    async function loadDatabase() {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Could not load saved UI database.");
        }

        const database = (await response.json()) as { schema?: unknown };
        const parsedSchema = uiSchema.safeParse(database.schema);

        if (parsedSchema.success && isMounted) {
          skipNextAutosave.current = true;
          setSchema(parsedSchema.data);
        }

        if (isMounted) {
          didLoadDatabase.current = true;
          setDatabaseStatus("saved");
        }
      } catch {
        if (isMounted) {
          didLoadDatabase.current = true;
          setDatabaseStatus("error");
        }
      }
    }

    loadDatabase();

    return () => {
      isMounted = false;
    };
  }, [setSchema]);

  useEffect(() => {
    if (!didLoadDatabase.current) {
      return;
    }

    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(async () => {
      try {
        const response = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema,
            source: "manual",
            message: "Autosaved UI schema update"
          })
        });

        if (!response.ok) {
          throw new Error("Save failed.");
        }

        setDatabaseStatus("saved");
      } catch {
        setDatabaseStatus("error");
      }
    }, 500);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [schema]);

  async function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = prompt.trim();
    if (!message || isStreaming) {
      return;
    }

    setStreaming(true);
    setError(null);

    try {
      const response = await fetch("/api/ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, schema })
      });

      if (!response.ok || !response.body) {
        throw new Error("The UI API did not return a stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          applyStreamLine(line);
        }
      }

      if (buffer.trim()) {
        applyStreamLine(buffer);
      }
    } catch (streamError) {
      setError(
        streamError instanceof Error
          ? streamError.message
          : "Could not stream the UI schema."
      );
    } finally {
      setStreaming(false);
    }
  }

  function applyStreamLine(line: string) {
    if (!line.trim()) {
      return;
    }

    let event: StreamEvent;

    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      setError("The AI stream returned a response that was not valid JSON.");
      return;
    }

    if (event.type === "error") {
      setError(event.error);
      return;
    }

    const parsedSchema = uiSchema.safeParse(event.schema);
    if (parsedSchema.success) {
      if (event.type === "final") {
        skipNextAutosave.current = true;
      }
      setSchema(parsedSchema.data);
      if (event.type === "final") {
        saveSchemaToDatabase(parsedSchema.data, prompt.trim() || parsedSchema.data.intent, "prompt").catch(
          (err) => {
            console.error("[workspace] Client-side database save failed:", err);
            setDatabaseStatus("error");
          }
        );
      }
      return;
    }

    if (event.type === "final") {
      setError("Claude returned JSON, but it did not match the ExcelFlow UI schema.");
    }
  }

  async function saveSchemaToDatabase(
    nextSchema: typeof schema,
    message: string,
    source: "prompt" | "manual" | "import" | "reset"
  ) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema: nextSchema,
            source,
            message
          })
        });

        if (!response.ok) {
          throw new Error(`Save failed with status ${response.status}`);
        }

        setDatabaseStatus("saved");
        return;
      } catch (saveError) {
        console.error(`[workspace] Save attempt ${attempt} failed:`, saveError);
        if (attempt === 3) {
          setDatabaseStatus("error");
          throw saveError;
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow">Schema UI</p>
            <h1>ExcelFlow</h1>
          </div>
        </div>

        <form className="prompt-panel" onSubmit={submitPrompt}>
          <label htmlFor="prompt">Claude instruction</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Turn this into an investor report and highlight weak margins."
            rows={7}
          />

          <div className="prompt-actions">
            <button className="icon-button secondary" type="button" onClick={() => setSchema(defaultSchema)} title="Reset schema">
              <RotateCcw size={18} aria-hidden="true" />
            </button>
            <button className="send-button" type="submit" disabled={isStreaming || !prompt.trim()}>
              {isStreaming ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Send size={18} aria-hidden="true" />
              )}
              <span>{isStreaming ? "Streaming" : "Generate"}</span>
            </button>
          </div>
        </form>

        <div className="schema-status" aria-live="polite">
          <span>{schema.layout}</span>
          <span>{schema.components.length} components</span>
          <span>{sheetCount} sheet</span>
          <span>{databaseStatus === "saved" ? "db saved" : databaseStatus === "loading" ? "db loading" : "db error"}</span>
        </div>

        <AnimatePresence>
          {error ? (
            <motion.p
              className="error-banner"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </aside>

      <section className="render-surface">
        <SchemaRenderer components={schema.components} />
      </section>
    </main>
  );
}
