import { useEffect, useRef, useState } from "react";
import type { PendingToolCall } from "../../core/api";
import { producedFiles, viewKind } from "../../core/files/produced";
import type { TaskView } from "../../core/tasks/taskMonitor";
import { STATE, TaskDetails, ago } from "../views/tasks/TaskDetails";
import "../views/workbench.css";
import "../views/files/files.css";
import "./dock.css";

/** What each tile's screen shows when it has no picture to show. */
const MARK: Record<TaskView["status"], string> = { running: "▍", needs_approval: "?", done: "✓", failed: "✗" };

const finished = (task: TaskView) => task.status === "done" || task.status === "failed";

// How long the card's CRT power-off and a tile's finishing glitch last (dock.css).
const POWER_OFF_MS = 200;
const GLITCH_MS = 900;

const MODEL: Record<string, string> = { "gpt-image-2.5-flare": "Flare", "gpt-image-2.5-sunburst": "Sunburst" };

/**
 * The strip on the screen edge, in THE WAY's own look: every background task is a small CRT
 * screen hanging off one glowing pipe -- the pulse in it runs faster while anything works --
 * and opens into a card that powers on like an old monitor, its steps drawn as a route.
 * A task that made a picture shows it on its screen; one waiting on the user can be
 * answered right here.
 *
 * The window behind this page is click-through except where something here is marked
 * data-hit, so it never takes clicks meant for the app underneath.
 */
export function Dock() {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  // finished tasks the user has looked at since; the rest wear a dot
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  // tiles that just finished, glitching for a moment: green for done, red for failed
  const [glitch, setGlitch] = useState<Record<string, "done" | "failed">>({});
  const thumbnails = useThumbnails(tasks);
  const statuses = useRef(new Map<string, TaskView["status"]>());
  const [, tick] = useState(0);

  useEffect(() => {
    const off = window.desktop.dock.onTasks(setTasks);
    void window.desktop.dock.tasks().then(setTasks);
    // keeps "hace 3 min" honest without a redraw on every event
    const clock = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      off();
      clearInterval(clock);
    };
  }, []);

  // A task that has just ended glitches once -- the moment it is seen to change, not on load.
  useEffect(() => {
    for (const task of tasks) {
      const before = statuses.current.get(task.id);
      statuses.current.set(task.id, task.status);
      if (!before || before === task.status || !finished(task)) continue;
      const kind = task.status as "done" | "failed";
      setGlitch((current) => ({ ...current, [task.id]: kind }));
      setTimeout(() => setGlitch(({ [task.id]: _, ...rest }) => rest), GLITCH_MS);
    }
  }, [tasks]);

  // Takes the mouse only while it is over something here. The strip keeps hearing the
  // pointer while it lets clicks through, which is what makes this possible at all.
  useEffect(() => {
    let over = false;
    const set = (next: boolean) => {
      if (next === over) return;
      over = next;
      window.desktop.dock.interactive(next);
    };
    const move = (event: MouseEvent) => set(event.target instanceof Element && event.target.closest("[data-hit]") !== null);
    const leave = () => set(false);
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseleave", leave);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseleave", leave);
    };
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const open = tasks.find((task) => task.id === openId) ?? null;
  const busy = tasks.some((task) => task.status === "running");

  /** The card powers off like a CRT -- down to a line, then a dot -- before it goes. */
  function close() {
    if (!openId || closing) return;
    setClosing(true);
    setTimeout(() => {
      setOpenId(null);
      setClosing(false);
    }, POWER_OFF_MS);
  }

  function toggle(task: TaskView) {
    if (openId === task.id) close();
    else {
      setClosing(false);
      setOpenId(task.id);
    }
    if (finished(task)) setSeen((current) => new Set(current).add(task.id));
  }

  function dismiss(task: TaskView) {
    if (openId === task.id) setOpenId(null);
    void window.desktop.dock.dismiss(task.id);
  }

  return (
    <div className="dock">
      {open && (
        <section
          key={open.id}
          className={`dock__card task task--${open.status}${closing ? " dock__card--off" : ""}`}
          data-hit
          aria-label="Tarea"
        >
          <header className="dock__card-head">
            <span className="task__state" aria-hidden="true">{MARK[open.status]}</span>
            <span className="dock__card-title">
              <span className="task__description">{open.description}</span>
              <span className="dock__prompt" key={`${open.status}-${open.steps.length}`}>
                <span className="dock__typed">
                  ❯ {STATE[open.status].toLowerCase()} · {ago(open.status === "running" ? open.createdAt : open.updatedAt)}
                  {" "}· {open.steps.length} {open.steps.length === 1 ? "paso" : "pasos"}
                </span>
              </span>
            </span>
            <button type="button" className="files__close" onClick={close} aria-label="Cerrar" title="Cerrar">×</button>
          </header>
          <div className="dock__card-body">
            <TaskDetails
              task={open}
              route
              approval={open.status === "needs_approval" ? <DockApproval task={open} /> : undefined}
              onOpenProject={(name, path) => window.desktop.dock.openProject(name, path)}
              onOpenConversation={(id) => window.desktop.dock.openConversation(id)}
              onReview={() => window.desktop.dock.review()}
              onOpenFile={(target) => window.desktop.dock.show(target)}
            />
          </div>
          {finished(open) && (
            <footer className="dock__card-foot">
              <button type="button" className="ghost-button ghost-button--danger" onClick={() => dismiss(open)}>DESCARTAR</button>
            </footer>
          )}
        </section>
      )}

      <div className={busy ? "dock__rail dock__rail--busy" : "dock__rail"}>
        <ul className="dock__icons" aria-label="Tareas en segundo plano">
          {tasks.map((task) => {
            const picture = thumbnails[task.id];
            return (
              <li key={task.id} className="dock__slot">
                <button
                  type="button"
                  data-hit
                  className={[
                    "dock__tile",
                    `dock__tile--${task.status}`,
                    openId === task.id && "dock__tile--open",
                    glitch[task.id] && `dock__tile--glitch-${glitch[task.id]}`,
                    picture && "dock__tile--picture",
                  ].filter(Boolean).join(" ")}
                  onClick={() => toggle(task)}
                  aria-expanded={openId === task.id}
                  title={`${task.description} · ${STATE[task.status]}`}
                >
                  <span className="dock__screen">
                    {picture && <img src={picture} alt="" className="dock__thumb" />}
                    <span className="dock__mark" aria-hidden="true">{picture && task.status === "done" ? "" : MARK[task.status]}</span>
                    {task.status === "running" && <span className="dock__count">{task.steps.length}</span>}
                  </span>
                  {finished(task) && !seen.has(task.id) && <span className="dock__unseen" aria-label="Nueva" />}
                </button>
                {finished(task) && (
                  <button type="button" data-hit className="dock__dismiss" onClick={() => dismiss(task)} aria-label="Descartar tarea" title="Descartar">×</button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * A waiting task answered right here: what it wants to do, which model, yes or no. The
 * answer goes into the same question the app window holds, so it is given only once.
 */
function DockApproval({ task }: { task: TaskView }) {
  const calls = task.pendingApproval ?? [];
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries(calls.map((call) => [call.id, modelOf(call)])));
  const [sent, setSent] = useState<"yes" | "no" | null>(null);

  async function answer(approved: boolean) {
    setSent(approved ? "yes" : "no");
    try {
      await window.desktop.dock.approve(
        task.id,
        calls.map((call) => ({ callId: call.id, approved, args: approved && picks[call.id] ? { model: picks[call.id] } : undefined })),
      );
    } catch {
      setSent(null);
    }
  }

  return (
    <div className="dock-ask">
      <p className="dock-ask__prompt">❯ ¿PERMITIR?</p>
      {calls.map((call) => (
        <div key={call.id} className="dock-ask__call">
          <p className="dock-ask__what selectable">{call.detail ?? call.name}</p>
          {call.preview && <pre className="dock-ask__preview selectable">{call.preview}</pre>}
          {(call.choices?.model?.length ?? 0) > 1 && (
            <div className="dock-ask__models" role="radiogroup" aria-label="Modelo">
              {call.choices!.model.map((model) => (
                <button
                  type="button"
                  key={model}
                  role="radio"
                  aria-checked={picks[call.id] === model}
                  className={picks[call.id] === model ? "dock-ask__model dock-ask__model--on" : "dock-ask__model"}
                  onClick={() => setPicks((current) => ({ ...current, [call.id]: model }))}
                >
                  {MODEL[model] ?? model}{call.name === "EditImage" ? " Edit" : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <p className="dock-ask__covers">Cubre hasta 10 imágenes en esta tarea.</p>
      <div className="dock-ask__answer">
        {sent ? (
          <span className="dock-ask__sent">{sent === "yes" ? "❯ aprobado · continuando…" : "❯ rechazado · sigue sin imágenes"}</span>
        ) : (
          <>
            <button type="button" className="ghost-button" onClick={() => void answer(false)}>[ NO ]</button>
            <button type="button" className="connect-button dock-ask__yes" onClick={() => void answer(true)}>[ SÍ ]</button>
          </>
        )}
      </div>
    </div>
  );
}

function modelOf(call: PendingToolCall): string {
  const asked = call.args.model;
  const offered = call.choices?.model ?? [];
  return typeof asked === "string" && offered.includes(asked) ? asked : offered[0] ?? "";
}

/**
 * A picture for each finished task that made one: its first image, delivered copy first.
 * Fetched once per task and kept as a blob URL for as long as the strip shows it.
 */
function useThumbnails(tasks: TaskView[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const made = useRef<string[]>([]);

  useEffect(() => {
    for (const task of tasks) {
      if (task.status !== "done" || asked.current.has(task.id)) continue;
      const image = producedFiles(task.result)
        .filter((file) => file.kind === "file" && viewKind("", file.path) === "image")
        .sort((a, b) => Number(a.project === ".the_way") - Number(b.project === ".the_way"))[0];
      if (!image) continue;
      asked.current.add(task.id);
      void window.desktop.dock.thumbnail(image.project, image.path).then((found) => {
        if (!found) return;
        const url = URL.createObjectURL(new Blob([found.data.slice()], { type: found.contentType }));
        made.current.push(url);
        setUrls((current) => ({ ...current, [task.id]: url }));
      }).catch(() => {});
    }
  }, [tasks]);

  useEffect(() => () => made.current.forEach((url) => URL.revokeObjectURL(url)), []);
  return urls;
}
