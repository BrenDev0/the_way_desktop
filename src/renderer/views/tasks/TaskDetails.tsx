import type { ReactElement, ReactNode } from "react";
import type { ViewTarget } from "../../../core/bridge";
import { producedFiles } from "../../../core/files/produced";
import type { TaskStep, TaskView } from "../../../core/tasks/taskMonitor";
import { FileChips } from "../files/FileChips";
import "../files/viewer.css";
import { PLACES, detail, toolInfo } from "../chat/tools";
import "./tasks.css";

export const STATE: Record<TaskView["status"], string> = {
  running: "EN CURSO",
  needs_approval: "ESPERA TU APROBACIÓN",
  done: "LISTA",
  failed: "FALLÓ",
};

export function ago(iso: string): string {
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

interface Props {
  task: TaskView;
  onOpenProject(name: string, path: string | null): void;
  onOpenConversation(id: string): void;
  /** Takes the user to the approval the task is waiting on. */
  onReview?(): void;
  /** Opens one of the files the task made. */
  onOpenFile?(target: ViewTarget): void;
  /** Steps drawn as stations along a route (the task strip) rather than a list. */
  route?: boolean;
  /** Shown in place of the "waiting for you" note, to answer right here. */
  approval?: ReactNode;
}

/**
 * A task's steps as a route -- THE WAY, drawn: one station per step, lit as it is passed.
 * A step that ran an assistant of its own shows how many calls that took, not each one.
 */
function Route({ steps, running }: { steps: TaskStep[]; running: boolean }) {
  const known = new Set(steps.map((step) => step.id));
  const stations = steps.filter((step) => !step.parentId || !known.has(step.parentId));
  const inner = (id: string) => steps.filter((step) => step.parentId === id).length;
  const passed = stations.filter((step) => step.state !== "running").length;
  return (
    <div className="route">
      <div className="route__head">
        <span>RUTA</span>
        <span>{passed} DE {stations.length} {stations.length === 1 ? "PARADA" : "PARADAS"}</span>
      </div>
      <ol className="route__line">
        {stations.map((step, index) => {
          const [label, place] = toolInfo(step.name);
          const about = detail(step.args);
          const calls = inner(step.id);
          const last = index === stations.length - 1;
          return (
            <li
              key={step.id}
              className={`route__stop route__stop--${step.state}${last && running ? " route__stop--head" : ""}`}
              title={`${label} · ${PLACES[place]}${about ? ` · ${about}` : ""}`}
            >
              <span className="route__node" aria-hidden="true" />
              <span className="route__label">{label}</span>
              {about && <span className="route__about">{about}</span>}
              {calls > 0 && <span className="route__inner">+{calls}</span>}
            </li>
          );
        })}
        {running && <li className="route__stop route__stop--next" aria-hidden="true"><span className="route__node" /><span className="route__label">…</span></li>}
      </ol>
    </div>
  );
}

/** What a task did -- its tool calls with their checkmarks, its result -- and where it went. */
export function TaskDetails({ task, onOpenProject, onOpenConversation, onReview, onOpenFile, route, approval }: Props) {
  const where = task.deliverProject ? `${task.deliverProject}${task.deliverPath ? `/${task.deliverPath}` : ""}` : null;
  // what it delivered first: that is the copy the user keeps
  const files = onOpenFile ? producedFiles(task.result).sort((a, b) => Number(a.project === ".the_way") - Number(b.project === ".the_way")) : [];
  return (
    <div className="task__body">
      {task.status === "needs_approval" && approval}
      {task.status === "needs_approval" && !approval && (
        <div className="task__waiting">
          <p>Se detuvo para pedir tu aprobación. Sigue en cuanto respondas (hasta 7 días).</p>
          {task.pendingApproval?.map((call) => (
            <p key={call.id} className="task__waiting-call selectable">{call.detail ?? call.name}</p>
          ))}
          {onReview && (
            <button type="button" className="connect-button task__review" onClick={onReview}>
              REVISAR Y APROBAR <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      )}
      {task.steps.length > 0 ? (
        route ? <Route steps={task.steps} running={task.status === "running"} /> : <StepList steps={task.steps} depth={0} />
      ) : (
        <p className="task__quiet">
          {task.status === "running" ? "Trabajando… los pasos aparecerán aquí." : "Sin pasos registrados en esta sesión."}
        </p>
      )}
      {files.length > 0 && onOpenFile && (
        <div className="task__files">
          <span className="task__files-label">ARCHIVOS</span>
          <FileChips files={files} onOpen={(target) => "local" in target || onOpenFile(target)} />
        </div>
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
  );
}
