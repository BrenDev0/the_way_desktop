import { describe, expect, it } from "vitest";
import {
  ApiError,
  type BackgroundTask,
  type Conversation,
  type ConversationEventsPort,
  type ServerApiPort,
} from "../../src/core/api";
import { pauseText } from "../../src/core/conversations/pause";
import { TurnService } from "../../src/core/conversations/turnService";
import type { SseEvent } from "../../src/core/sse";
import { TaskMonitor, type TaskView } from "../../src/core/tasks/taskMonitor";
import { ToolRunner } from "../../src/core/tools/runner";

function conversation(status: Conversation["status"], overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv", title: "t", client: "desktop", status, pendingToolCalls: [],
    iterationsUsed: 0, totalTokens: 0, createdAt: "", updatedAt: "", ...overrides,
  };
}

const stoppedTurn = conversation("paused", {
  pause: { reason: "stopped", detail: "", pausedAt: "2026-10-27T10:00:00Z", retryAfter: null },
});

/** Answers each request from a table keyed "METHOD path", and remembers what was asked. */
class Api implements ServerApiPort {
  readonly asked: string[] = [];
  constructor(private readonly answers: Record<string, unknown | Error>) {}
  async request<T>(method: string, path: string): Promise<T> {
    this.asked.push(`${method} ${path}`);
    const answer = this.answers[`${method} ${path}`];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) throw new Error(`unexpected ${method} ${path}`);
    return answer as T;
  }
}

class NoStream implements ConversationEventsPort {
  // eslint-disable-next-line require-yield
  async *open(): AsyncIterable<SseEvent> {
    return;
  }
}

function turns(api: ServerApiPort) {
  const updates: Conversation[] = [];
  const service = new TurnService(api, new NoStream(), new ToolRunner({}, { request: async () => ({ approved: true }) }), {
    update: (c) => updates.push(c),
  });
  return { service, updates };
}

describe("stopping a turn", () => {
  it("asks the server to stop and shows what it answers", async () => {
    const api = new Api({ "POST /conversations/conv/stop": stoppedTurn });
    const { service, updates } = turns(api);

    const stopped = await service.stop("conv");

    expect(stopped.status).toBe("paused");
    expect(api.asked).toEqual(["POST /conversations/conv/stop"]);
    expect(updates).toEqual([stoppedTurn]);
  });

  it("is not an error when the turn ended by itself an instant before", async () => {
    const idle = conversation("idle");
    const api = new Api({
      "POST /conversations/conv/stop": new ApiError(409, "conversation_not_running", "This conversation has nothing running to stop"),
      "GET /conversations/conv": idle,
    });

    const result = await turns(api).service.stop("conv");

    expect(result).toEqual(idle);
  });

  it("does not hide any other failure", async () => {
    const api = new Api({ "POST /conversations/conv/stop": new ApiError(500, "internal_server_error", "boom") });

    await expect(turns(api).service.stop("conv")).rejects.toThrow("boom");
  });

  it("has no questions on screen for a conversation nothing is settling", () => {
    expect(turns(new Api({})).service.settling("conv")).toEqual([]);
  });
});

describe("what the user is told", () => {
  it("says they stopped the agent and how to carry on, not that something failed", () => {
    const { title, body } = pauseText(stoppedTurn.pause);

    expect(title).toBe("Detuviste a AGENTIX");
    expect(body).toContain("Reanudar");
    expect(`${title} ${body}`).not.toMatch(/error|falló|limit/i);
  });
});

// --- tasks -------------------------------------------------------------------------------------

function task(status: BackgroundTask["status"], overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "t1", conversationId: "conv", description: "Informe", status, result: null,
    deliverProject: null, deliverPath: null, createdAt: "2026-10-27T10:00:00Z", updatedAt: "2026-10-27T10:00:00Z",
    ...overrides,
  };
}

class TaskApi implements ServerApiPort {
  readonly asked: string[] = [];
  list: BackgroundTask[] = [];
  after: Record<string, BackgroundTask> = {};
  async request<T>(method: string, path: string): Promise<T> {
    this.asked.push(`${method} ${path}`);
    if (method === "GET" && path === "/background-tasks") return this.list as T;
    if (method === "GET") return (this.list.find((t) => path.endsWith(t.id)) ?? this.after[path]) as T;
    return this.after[`${method} ${path}`] as T;
  }
}

class TaskStream implements ConversationEventsPort {
  async *open(_id: string, _last: string | undefined, signal: AbortSignal): AsyncIterable<SseEvent> {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
  }
}

function monitor(api: TaskApi) {
  const seen = { lists: [] as TaskView[][], finished: [] as TaskView[] };
  const tasks = new TaskMonitor(api, new TaskStream(), {
    changed: (list) => seen.lists.push(list),
    finished: (done) => seen.finished.push(done),
  }, { refreshMilliseconds: 60_000 });
  return { tasks, seen, last: () => seen.lists[seen.lists.length - 1] ?? [] };
}

describe("stopping and resuming a background task", () => {
  it("shows a running task as stopping until the server says it ended, then as stopped", async () => {
    const api = new TaskApi();
    api.list = [task("running")];
    api.after["POST /background-tasks/t1/stop"] = task("running");
    const { tasks, last } = monitor(api);
    await tasks.refresh();

    await tasks.stopTask("t1");

    expect(api.asked).toContain("POST /background-tasks/t1/stop");
    expect(last()[0].status).toBe("running");
    expect(last()[0].stopping).toBe(true);

    // its worker reached a safe point and said so on the conversation's stream
    api.list = [task("stopped", { result: "TASK STOPPED BY THE USER" })];
    await tasks.refresh();
    expect(last()[0].status).toBe("stopped");
    expect(last()[0].stopping).toBeFalsy();
    tasks.stop();
  });

  it("does not announce a stopped task as finished: the user pressed the button", async () => {
    const api = new TaskApi();
    api.list = [task("running")];
    const { tasks, seen } = monitor(api);
    await tasks.refresh();

    api.list = [task("stopped")];
    await tasks.refresh();

    expect(seen.finished).toEqual([]);
    tasks.stop();
  });

  it("stops a task waiting on an approval at once", async () => {
    const api = new TaskApi();
    api.list = [task("needs_approval")];
    api.after["POST /background-tasks/t1/stop"] = task("stopped");
    const { tasks, last } = monitor(api);
    await tasks.refresh();

    await tasks.stopTask("t1");

    expect(last()[0].status).toBe("stopped");
    expect(last()[0].stopping).toBeFalsy();
    tasks.stop();
  });

  it("resumes a stopped task, which then counts as running again", async () => {
    const api = new TaskApi();
    api.list = [task("stopped")];
    api.after["POST /background-tasks/t1/resume"] = task("running");
    const { tasks, last } = monitor(api);
    await tasks.refresh();

    await tasks.resumeTask("t1");

    expect(api.asked).toContain("POST /background-tasks/t1/resume");
    expect(last()[0].status).toBe("running");
    tasks.stop();
  });

  it("names the calls a waiting task asks about, so their questions can come down on a stop", async () => {
    const api = new TaskApi();
    api.list = [
      task("needs_approval", {
        pendingApproval: [{ id: "img1", name: "GenerateImages", args: {}, location: "server", requiresApproval: true, detail: null }],
      }),
    ];
    const { tasks } = monitor(api);
    await tasks.refresh();

    expect(tasks.pendingCalls("t1")).toEqual(["img1"]);
    expect(tasks.pendingCalls("nope")).toEqual([]);
    tasks.stop();
  });
});
