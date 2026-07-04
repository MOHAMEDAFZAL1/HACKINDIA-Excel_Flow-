"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Activity, BarChart3, CheckCircle2, FileText, TriangleAlert } from "lucide-react";
import { ExeSheet } from "@/components/exe-sheet";
import { ExeWorkbook } from "@/components/exe-workbook";
import { TaskBoard } from "@/components/task-board";
import type { UiComponent } from "@/lib/ui-schema";

type Props = {
  components: UiComponent[];
};

export function SchemaRenderer({ components }: Props) {
  const safeComponents = Array.isArray(components) ? components : [];

  return (
    <motion.div className="component-grid" layout>
      <AnimatePresence mode="popLayout">
        {safeComponents.map((component) => (
          <RenderedComponent component={component} key={component.id} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function RenderedComponent({ component }: { component: UiComponent }) {
  const baseMotion = {
    layout: true,
    initial: { opacity: 0, y: 14, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -10, scale: 0.98 },
    transition: { duration: 0.24 }
  };

  if (component.type === "hero") {
    return (
      <motion.header className="hero-band" layoutId={component.id} {...baseMotion}>
        <div>
          <p className="eyebrow">Live schema renderer</p>
          <h2>{component.title}</h2>
          <p>{component.subtitle}</p>
        </div>
        {component.action ? <span className="hero-action">{component.action}</span> : null}
      </motion.header>
    );
  }

  if (component.type === "metric") {
    return (
      <motion.article
        className={`metric-card tone-${component.tone}`}
        layoutId={component.id}
        {...baseMotion}
      >
        <MetricIcon tone={component.tone} />
        <div>
          <p>{component.label}</p>
          <strong>{component.value}</strong>
          {component.detail ? <span>{component.detail}</span> : null}
        </div>
      </motion.article>
    );
  }

  if (component.type === "text") {
    return (
      <motion.article className="text-card" layoutId={component.id} {...baseMotion}>
        <FileText size={20} aria-hidden="true" />
        <div>
          {component.title ? <h3>{component.title}</h3> : null}
          <p>{component.body}</p>
        </div>
      </motion.article>
    );
  }

  if (component.type === "sheet") {
    return (
      <motion.div className="sheet-frame" layoutId={component.id} {...baseMotion}>
        <ExeSheet componentId={component.id} component={component} />
      </motion.div>
    );
  }

  if (component.type === "workbook") {
    return (
      <motion.div className="sheet-frame" layoutId={component.id} {...baseMotion}>
        <ExeWorkbook componentId={component.id} component={component} />
      </motion.div>
    );
  }

  if (component.type === "taskBoard") {
    return (
      <motion.div className="task-board-frame" layoutId={component.id} {...baseMotion}>
        <TaskBoard componentId={component.id} component={component} />
      </motion.div>
    );
  }

  return (
    <motion.section className="schema-section" layoutId={component.id} {...baseMotion}>
      <div className="section-heading">
        <BarChart3 size={20} aria-hidden="true" />
        <h3>{component.title}</h3>
      </div>
      <SchemaRenderer components={component.children ?? []} />
    </motion.section>
  );
}

function MetricIcon({ tone }: { tone: "neutral" | "good" | "warn" | "bad" }) {
  if (tone === "good") {
    return <CheckCircle2 size={22} aria-hidden="true" />;
  }

  if (tone === "warn" || tone === "bad") {
    return <TriangleAlert size={22} aria-hidden="true" />;
  }

  return <Activity size={22} aria-hidden="true" />;
}
