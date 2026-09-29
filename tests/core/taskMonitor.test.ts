import { describe, expect, it } from "vitest";
import type { BackgroundTask, ConversationEventsPort, ServerApiPort } from "../../src/core/api";
import type { SseEvent } from "../../src/core/sse";
import { TaskMonitor, type TaskView } from "../../src/core/tasks/taskMonitor";

function task(id: string, status: BackgroundTask["status"], overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id, conversationId: "conv", description: `Tarea ${id}`, status, result: null,
    deliverProject: null, deliverPath: null, createdAt: "2026-09-29T10:00:00Z", updatedAt: "2026-09-29T10:00:00Z",
    ...overrides,
  };
}

const ev = (type: string, data: object, id?: string): SseEvent => ({ id, type, data: JSON.stringify(data) });

/** Each open() plays the next scripted connection, then ends. */
class ScriptedStream implements ConversationEventsPort {
  readonly opened: { conversationId: string; lastEventId: string | undefined }[] = [];
  constructor(private readonly connections: SseEvent[][]) {}
  async *open(conversationId: string, lastEventId: string | undefined, signal: AbortSignal): AsyncIterable<SseEvent> {
    this.opened.push({ conversationId, lastEventId });
    for (const event of this.connections.shift() ?? []) {
      if (signal.aborted) return;
      await Promise.resolve();
      yield event;
    }
  }
}

/** The task list and single-task reads, answered from a table the test edits. */
class Tasks implements ServerApiPort {
  readonly table = new Map<string, BackgroundTask>();
  async request<T>(_method: string, path: string): Promise<T> {
    if (path === "/background-tasks") return [...this.table.values()] as T;
    const found = this.table.get(path.split("/").pop()!);
    if (!found) throw new Error("not found");
    return { ...found } as T;
  }
}

function monitor(stream: ConversationEventsPort, api: Tasks) {
  const seen = { lists: [] as TaskView[][], finished: [] as TaskView[] };
  const tasks = new TaskMonitor(api, stream, {
    changed: (list) => seen.lists.push(list),
    finished: (done) => seen.finished.push(done),
    // a real (short) wait: back-off must yield to timers, as it does in the app
  }, { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))), refreshMilliseconds: 60_000 });
  return { tasks, seen, last: () => seen.lists[seen.lists.length - 1] ?? [] };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("TaskMonitor", () => {
  it("follows a running task's conversation and collects its tool calls live", async () => {
    const api = new Tasks();
    api.table.set("t1", task("t1", "running"));
    api.table.set("t0", task("t0", "done", { updatedAt: "2026-09-28T10:00:00Z" }));
    const stream = new ScriptedStream([[
      ev("status", { id: "conv", status: "idle" }),
      ev("tool.started", { id: "a", name: "WebSearch", args: { query: "crm" }, taskId: "t1" }, "5-0"),
      ev("tool.started", { id: "b", name: "WriteProjectFile", args: {}, taskId: "t1", parentId: "a" }, "6-0"),
      ev("tool.finished", { id: "b", name: "WriteProjectFile", failed: true, taskId: "t1" }, "7-0"),
      ev("tool.finished", { id: "a", name: "WebSearch", failed: false, taskId: "t1" }, "8-0"),
    ]]);
    const { tasks, last } = monitor(stream, api);

    await tasks.refresh();
    await settle();

    // still running when the connection ends: it reconnects, resuming after the last event seen
    expect(stream.opened[0]).toEqual({ conversationId: "conv", lastEventId: undefined });
    expect(stream.opened.length).toBeGreaterThan(1);
    expect(stream.opened.slice(1).every((open) => open.lastEventId === "8-0")).toBe(true);
    expect(last().map((t) => t.id)).toEqual(["t1", "t0"]);
    expect(last()[0].steps).toEqual([
      { id: "a", name: "WebSearch", args: { query: "crm" }, state: "done", parentId: undefined },
      { id: "b", name: "WriteProjectFile", args: {}, state: "failed", parentId: "a" },
    ]);
    tasks.stop();
  });

  it("marks the end, reads the result, announces once and stops following", async () => {
    const api = new Tasks();
    api.table.set("t1", task("t1", "running"));
    const stream = new ScriptedStream([[
      ev("task.finished", { taskId: "t1", description: "Informe CX", status: "done" }, "9-0"),
    ]]);
    const { tasks, seen, last } = monitor(stream, api);

    await tasks.refresh();
    api.table.set("t1", task("t1", "done", { result: "Entregado en test_report/reports", deliverProject: "test_report", deliverPath: "reports" }));
    await settle();

    expect(last()[0]).toMatchObject({ status: "done", result: "Entregado en test_report/reports", deliverProject: "test_report" });
    expect(seen.finished.map((t) => t.id)).toEqual(["t1"]);
    expect(stream.opened).toHaveLength(1);
    tasks.stop();
  });

  it("picks up after the turn's stream, from the event where the task started", async () => {
    const api = new Tasks();
    api.table.set("t2", task("t2", "running"));
    const stream = new ScriptedStream([[ev("task.finished", { taskId: "t2", description: "x", status: "failed" }, "12-0")]]);
    const { tasks, seen, last } = monitor(stream, api);

    tasks.track("conv", { taskId: "t2", description: "Limpiar contactos", state: "started" }, "11-0");
    await settle();

    expect(stream.opened).toEqual([{ conversationId: "conv", lastEventId: "11-0" }]);
    expect(last()[0].status).toBe("failed");
    expect(seen.finished).toHaveLength(1);
    tasks.stop();
  });

  it("is not moved by the same event twice, or by a read older than the end", async () => {
    const api = new Tasks();
    api.table.set("t3", task("t3", "running"));
    const stream = new ScriptedStream([[]]);
    const { tasks, seen, last } = monitor(stream, api);
    await tasks.refresh();

    const started = { id: "s", name: "ReadProjectFile", state: "started" as const, args: { path: "a.md" }, taskId: "t3" };
    tasks.activity(started);
    tasks.activity({ ...started, state: "finished", failed: false });
    tasks.activity(started); // replayed by the other stream
    expect(last()[0].steps).toEqual([{ id: "s", name: "ReadProjectFile", args: { path: "a.md" }, state: "done", parentId: undefined }]);

    tasks.track("conv", { taskId: "t3", description: "x", state: "finished", status: "done" });
    await settle();
    await tasks.refresh(); // the server still says running: an old read
    expect(last()[0].status).toBe("done");
    expect(seen.finished).toHaveLength(1);
    tasks.stop();
  });

  it("opens no stream when nothing is running", async () => {
    const api = new Tasks();
    api.table.set("t4", task("t4", "done"));
    const stream = new ScriptedStream([]);
    const { tasks } = monitor(stream, api);
    await tasks.refresh();
    await settle();
    expect(stream.opened).toEqual([]);
  });
});
