import { useEffect, useState, type ReactElement } from "react";
import type { TaskStep, TaskView } from "../../../core/tasks/taskMonitor";
import { PLACES, detail, toolInfo } from "../chat/tools";
import "./tasks.css";

interface Props {
  onOpenProject(name: string, path: string | null): void;
  onOpenConversation(id: string): void;
  onClose?(): void;
}

const STATE: Record<TaskView["status"], string> = { running: "EN CURSO", done: "LISTA", failed: "FALLÓ" };

function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "ahora";
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.round(seconds / 3600)} h`;
  return `hace ${Math.round(seconds / 86400)} d`;
}

/** Steps as a tree: a tool that runs an assistant of its own shows that assistant's calls under it. */
function StepList({ steps, parentId, depth }: { steps: TaskStep[]; parentId?: string; depth: number }): ReactElement | null {
  const known = new Set(steps.map((step) => step.id));
  const level = steps.filter((step) => (parentId ? step.parentId === parentId : !step.parentId || !known.has(step.parentId)));
  if (!level.length) return null;
  return (
    <ul className={depth ? "task__steps task__steps--nested" : "task__steps"}>
      {level.map((step) => {
        const [label, place] = toolInfo(step.name);
        const about = detail(step.args);
        return (
          <li key={step.id}>
            <div className={`task-step task-step--${step.state}`} title={`${label} · ${PLACES[place]}${about ? ` · ${about}` : ""}`}>
              <span className="task-step__state" aria-hidden="true">{step.state === "running" ? "…" : step.state === "done" ? "✓" : "✗"}</span>
              <span className="task-step__label">{label}</span>
              {about && <span className="task-step__about">{about}</span>}
            </div>
            <StepList steps={steps} parentId={step.id} depth={depth + 1} />
          </li>
        );
      })}
    </ul>
  );
}

/** Every background task, newest running first, with its tool calls as they happen. */
export function TasksPanel({ onOpenProject, onOpenConversation, onClose }: Props) {
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [failed, setFailed] = useState(false);
  // running tasks start open; a click toggles any task, and is remembered
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [, tick] = useState(0);

  useEffect(() => {
    const off = window.desktop.tasks.onChanged(setTasks);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load(tries: number) {
      try {
        const list = await window.desktop.tasks.list();
        if (cancelled) return;
        setTasks(list);
        setFailed(false);
      } catch {
        if (cancelled) return;
        setFailed(true);
        timer = setTimeout(() => void load(tries + 1), Math.min(2000 * 2 ** tries, 15000));
      }
    }
    void load(0);
    // keeps "hace 3 min" honest without a redraw on every event
    const clock = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(clock);
      off();
    };
  }, []);

  const running = tasks?.filter((task) => task.status === "running").length ?? 0;

  return (
    <aside className="tasks" aria-label="Tareas">
      <header className="tasks__header">
        <span className="tasks__title">TAREAS</span>
        {running > 0 && <span className="tasks__count"><span className="tasks__pulse" aria-hidden="true" />{running} EN CURSO</span>}
        {onClose && <button type="button" className="files__close" onClick={onClose} aria-label="Ocultar tareas" title="Ocultar tareas">×</button>}
      </header>

      <div className="tasks__list">
        {failed && !tasks && <p className="files__hint tasks__hint">Sin conexión con el servidor. Reintentando…</p>}
        {!failed && !tasks && <p className="files__hint tasks__hint">Cargando…</p>}
        {tasks && !tasks.length && (
          <p className="files__hint tasks__hint">Sin tareas todavía. Cuando pidas algo largo, el agente lo hará en segundo plano y lo verás aquí.</p>
        )}
        {tasks?.map((task) => {
          const open = toggled[task.id] ?? task.status === "running";
          const where = task.deliverProject ? `${task.deliverProject}${task.deliverPath ? `/${task.deliverPath}` : ""}` : null;
          return (
            <section key={task.id} className={`task task--${task.status}`}>
              <button type="button" className="task__head" aria-expanded={open} onClick={() => setToggled((current) => ({ ...current, [task.id]: !open }))}>
                <span className="task__state" aria-hidden="true">{task.status === "running" ? <span className="tasks__pulse" /> : task.status === "done" ? "✓" : "✗"}</span>
                <span className="task__description">{task.description}</span>
                <span className="task__meta">{STATE[task.status]} · {ago(task.status === "running" ? task.createdAt : task.updatedAt)}</span>
              </button>

              {open && (
                <div className="task__body">
                  {task.steps.length > 0 ? <StepList steps={task.steps} depth={0} /> : (
                    <p className="task__quiet">
                      {task.status === "running" ? "Trabajando… los pasos aparecerán aquí." : "Sin pasos registrados en esta sesión."}
                    </p>
                  )}
                  {task.result && (
                    <details className="task__result">
                      <summary>RESULTADO</summary>
                      <pre className="selectable">{task.result}</pre>
                    </details>
                  )}
                  <div className="task__actions">
                    {where && task.status === "done" && (
                      <button type="button" className="ghost-button" onClick={() => onOpenProject(task.deliverProject!, task.deliverPath)}>
                        VER ARCHIVOS <span className="task__where">{where}</span>
                      </button>
                    )}
                    {task.conversationId && (
                      <button type="button" className="ghost-button" onClick={() => onOpenConversation(task.conversationId!)}>CONVERSACIÓN</button>
                    )}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
