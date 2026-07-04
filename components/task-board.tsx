"use client";

import { CalendarClock, FileText, Plus, StickyNote, Trash2 } from "lucide-react";
import type { TaskItem, TaskNote, UiComponent } from "@/lib/ui-schema";
import { useUiStore } from "@/store/ui-store";

type TaskBoardComponent = Extract<UiComponent, { type: "taskBoard" }>;

type Props = {
  componentId: string;
  component: TaskBoardComponent;
};

export function TaskBoard({ componentId, component }: Props) {
  const updateTaskBoard = useUiStore((state) => state.updateTaskBoard);

  function commit(nextComponent: TaskBoardComponent) {
    updateTaskBoard(componentId, nextComponent);
  }

  function updateTask(taskId: string, patch: Partial<TaskItem>) {
    commit({
      ...component,
      tasks: component.tasks.map((task) =>
        task.id === taskId ? { ...task, ...patch } : task
      )
    });
  }

  function updateNote(noteId: string, patch: Partial<TaskNote>) {
    commit({
      ...component,
      notes: component.notes.map((note) =>
        note.id === noteId ? { ...note, ...patch } : note
      )
    });
  }

  function addTask() {
    const nextTaskNumber = component.tasks.length + 1;
    commit({
      ...component,
      tasks: [
        ...component.tasks,
        {
          id: `task-${Date.now()}`,
          title: `Task ${nextTaskNumber}`,
          dueAt: localInputDateTime(new Date()),
          status: "todo",
          priority: "medium",
          note: ""
        }
      ]
    });
  }

  function removeTask(taskId: string) {
    commit({
      ...component,
      tasks: component.tasks.filter((task) => task.id !== taskId),
      notes: component.notes.map((note) =>
        note.linkedTaskId === taskId ? { ...note, linkedTaskId: undefined } : note
      )
    });
  }

  function addNote() {
    const nextNoteNumber = component.notes.length + 1;
    commit({
      ...component,
      notes: [
        ...component.notes,
        {
          id: `note-${Date.now()}`,
          title: `Note ${nextNoteNumber}`,
          body: "Write a note or ask Claude to generate one from your prompt."
        }
      ]
    });
  }

  function removeNote(noteId: string) {
    commit({
      ...component,
      notes: component.notes.filter((note) => note.id !== noteId)
    });
  }

  return (
    <section className="task-board">
      <div className="task-board-header">
        <div className="section-heading task-heading">
          <CalendarClock size={20} aria-hidden="true" />
          <div>
            <h3>{component.title}</h3>
            {component.summary ? <p>{component.summary}</p> : null}
          </div>
        </div>
        <div className="task-board-actions">
          <button className="tool-button secondary" type="button" onClick={addNote}>
            <StickyNote size={17} aria-hidden="true" />
            <span>Note</span>
          </button>
          <button className="tool-button" type="button" onClick={addTask}>
            <Plus size={17} aria-hidden="true" />
            <span>Task</span>
          </button>
        </div>
      </div>

      <div className="task-layout">
        <div className="task-list">
          {component.tasks.map((task) => (
            <article className="task-row" key={task.id}>
              <div className="task-row-main">
                <input
                  aria-label="Task title"
                  value={task.title}
                  onChange={(event) => updateTask(task.id, { title: event.target.value })}
                />
                <textarea
                  aria-label="Task note"
                  value={task.note ?? ""}
                  onChange={(event) => updateTask(task.id, { note: event.target.value })}
                  rows={2}
                />
              </div>

              <div className="task-controls">
                <input
                  aria-label="Due date"
                  type="datetime-local"
                  value={toDateTimeInput(task.dueAt)}
                  onChange={(event) => updateTask(task.id, { dueAt: event.target.value })}
                />
                <select
                  aria-label="Task status"
                  value={task.status}
                  onChange={(event) =>
                    updateTask(task.id, {
                      status: event.target.value as TaskItem["status"]
                    })
                  }
                >
                  <option value="todo">To do</option>
                  <option value="doing">Doing</option>
                  <option value="done">Done</option>
                </select>
                <select
                  aria-label="Task priority"
                  value={task.priority}
                  onChange={(event) =>
                    updateTask(task.id, {
                      priority: event.target.value as TaskItem["priority"]
                    })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <input
                  aria-label="Assignee"
                  placeholder="Assignee"
                  value={task.assignee ?? ""}
                  onChange={(event) =>
                    updateTask(task.id, { assignee: event.target.value })
                  }
                />
                <button
                  className="icon-button secondary"
                  type="button"
                  onClick={() => removeTask(task.id)}
                  title="Remove task"
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="note-list">
          {component.notes.map((note) => (
            <article className="note-card" key={note.id}>
              <div className="note-card-header">
                <FileText size={18} aria-hidden="true" />
                <input
                  aria-label="Note title"
                  value={note.title}
                  onChange={(event) => updateNote(note.id, { title: event.target.value })}
                />
                <button
                  className="icon-button secondary"
                  type="button"
                  onClick={() => removeNote(note.id)}
                  title="Remove note"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
              <textarea
                aria-label="Note body"
                value={note.body}
                onChange={(event) => updateNote(note.id, { body: event.target.value })}
                rows={5}
              />
              <select
                aria-label="Linked task"
                value={note.linkedTaskId ?? ""}
                onChange={(event) =>
                  updateNote(note.id, {
                    linkedTaskId: event.target.value || undefined
                  })
                }
              >
                <option value="">No linked task</option>
                {component.tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function toDateTimeInput(value: string) {
  return value.slice(0, 16);
}

function localInputDateTime(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
