/**
 * The user's background tasks, kept current for the tasks column.
 *
 * A task runs on the server after the turn that started it has ended, and publishes its
 * tool calls and its end on that conversation's event stream -- which only reaches a client
 * that keeps the stream open. So this keeps one stream open per conversation that has a
 * running task, and closes it once none are left. GET /background-tasks is the ground truth
 * behind it: read at start-up, whenever a task ends, and on a slow timer while any runs, so
 * a task started elsewhere or a missed event still shows up.
 *
 * Every update is keyed by task and call id, so the same event arriving twice (from the
 * turn's own stream and from here) changes nothing.
 */

import {
  ApiError,
  type BackgroundTask,
  type ConversationEventsPort,
  type PendingToolCall,
  type ServerApiPort,
  type TaskEvent,
  type ToolActivity,
  type ToolResolution,
} from "../api";
import type { SseEvent } from "../sse";
import { decidedResolution, type ApprovalPort } from "../tools/runner";

export interface TaskStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  state: "running" | "done" | "failed";
  /** The step this one runs inside, when a tool runs an assistant of its own. */
  parentId?: string;
}

export interface TaskView extends BackgroundTask {
  /** The tool calls seen while this app was watching, in the order they started. */
  steps: TaskStep[];
}

export interface TaskMonitorEvents {
  changed(tasks: TaskView[]): void;
  /** A task seen running has just ended. Not called for tasks that were already over. */
  finished?(task: TaskView): void;
  /** A task has stopped to ask the user something; the monitor is asking them now. */
  needsApproval?(task: TaskView): void;
}

export interface TaskMonitorOptions {
  silenceMilliseconds?: number;
  refreshMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Most tasks kept for the column; the newest win. */
  limit?: number;
  /** Where a task that stops for the user's approval asks them. Without it, nobody is
   *  asked and the task waits (up to the server's 7 days) for an app that can. */
  approvals?: ApprovalPort;
}

/** Still under way, from the user's side: working, or waiting for them to answer. */
const live = (task: { status: TaskView["status"] }) => task.status === "running" || task.status === "needs_approval";

const MAX_STEPS = 300;
const RETRY_LIMIT_MS = 10_000;
// A server stream lasts 30 minutes; one that ends sooner than this is treated as a failure,
// so a stream that keeps closing at once is retried with back-off, not in a tight loop.
const HEALTHY_STREAM_MS = 5_000;
const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class TaskMonitor {
  private readonly tasks = new Map<string, TaskView>();
  private readonly following = new Map<string, AbortController>();
  private readonly announced = new Set<string>();
  // tasks whose question is on screen now -- asked once, however many times it is heard
  private readonly asking = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly silence: number;
  private readonly refreshEvery: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly limit: number;
  private readonly approvals: ApprovalPort | undefined;

  constructor(
    private readonly api: ServerApiPort,
    private readonly stream: ConversationEventsPort,
    private readonly events: TaskMonitorEvents,
    options: TaskMonitorOptions = {},
  ) {
    this.silence = options.silenceMilliseconds ?? 45_000;
    this.refreshEvery = options.refreshMilliseconds ?? 20_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.limit = options.limit ?? 50;
    this.approvals = options.approvals;
  }

  /** Running first (newest first), then the rest by when they last changed. */
  list(): TaskView[] {
    const running = (task: TaskView) => (live(task) ? 0 : 1);
    return [...this.tasks.values()]
      .sort((a, b) => running(a) - running(b) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, this.limit)
      .map((task) => ({ ...task, steps: [...task.steps] }));
  }

  /** Reads the task list, and follows every conversation that has a task still running. */
  async refresh(): Promise<TaskView[]> {
    this.stopped = false;
    const fetched = await this.api.request<BackgroundTask[]>("GET", "/background-tasks");
    for (const task of fetched) this.merge(task);
    for (const task of fetched) {
      if (live(task) && task.conversationId) this.follow(task.conversationId);
    }
    this.schedule();
    this.emit();
    for (const task of fetched) if (task.status === "needs_approval") this.ask(task.id);
    return this.list();
  }

  /** Answers what a task stopped to ask; it carries on on the server from where it stopped. */
  async approve(taskId: string, resolutions: ToolResolution[]): Promise<void> {
    const resumed = await this.api.request<BackgroundTask>("POST", `/background-tasks/${taskId}/approvals`, {
      resolutions,
    });
    this.merge(resumed);
    if (resumed.conversationId) this.follow(resumed.conversationId);
    this.schedule();
    this.emit();
  }

  /**
   * Puts a waiting task's question to the user -- every call it waits on, one at a time,
   * with the same dialog the chat uses -- and sends the answers. A question closed
   * unanswered (the window went away) is not a refusal: it is asked again later.
   */
  private ask(taskId: string): void {
    const task = this.tasks.get(taskId);
    const pending = task?.pendingApproval ?? [];
    if (!this.approvals || !task || task.status !== "needs_approval" || !pending.length || this.asking.has(taskId)) return;
    this.asking.add(taskId);
    this.events.needsApproval?.({ ...task, steps: [...task.steps] });

    void (async () => {
      try {
        const resolutions: ToolResolution[] = [];
        for (const call of pending) {
          const decision = await this.approvals!.request({ call, preview: call.preview ?? undefined, origin: task.description });
          if (decision.dismissed) return;
          resolutions.push(decidedResolution(call, decision));
        }
        await this.approve(taskId, resolutions);
      } catch {
        // answered elsewhere, or expired: the list says where it stands now
        void this.refresh().catch(() => {});
      } finally {
        this.asking.delete(taskId);
      }
    })();
  }

  /** A task event the turn's own stream saw; `eventId` is where to carry on after the turn. */
  track(conversationId: string, event: TaskEvent, eventId?: string): void {
    this.applyTask(conversationId, event);
    if (event.state === "started") this.follow(conversationId, eventId);
  }

  /** A tool call the turn's own stream saw; only a background task's (taskId) matter here. */
  activity(tool: ToolActivity): void {
    if (tool.taskId && this.applyStep(tool)) this.emit();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const controller of this.following.values()) controller.abort();
    this.following.clear();
    this.tasks.clear();
    this.announced.clear();
    this.asking.clear();
  }

  private follow(conversationId: string, lastEventId?: string): void {
    if (this.stopped || this.following.has(conversationId)) return;
    const controller = new AbortController();
    this.following.set(conversationId, controller);
    void this.watch(conversationId, lastEventId, controller).finally(() => {
      if (this.following.get(conversationId) === controller) this.following.delete(conversationId);
    });
  }

  private async watch(conversationId: string, after: string | undefined, owner: AbortController): Promise<void> {
    let lastEventId = after;
    let failures = 0;
    while (!owner.signal.aborted && this.hasRunning(conversationId)) {
      const connection = new AbortController();
      const abort = () => connection.abort();
      owner.signal.addEventListener("abort", abort);
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const listen = () => {
        clearTimeout(quiet);
        quiet = setTimeout(abort, this.silence);
      };
      const opened = Date.now();
      let healthy = false;
      try {
        listen();
        for await (const event of this.stream.open(conversationId, lastEventId, connection.signal)) {
          listen();
          if (event.id) lastEventId = event.id;
          if (this.handle(conversationId, event)) this.emit();
          if (!this.hasRunning(conversationId)) return;
        }
        healthy = Date.now() - opened >= HEALTHY_STREAM_MS;
      } catch (error) {
        if (owner.signal.aborted) return;
        // signed out, or the conversation is gone: no retry will change that
        if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return;
      } finally {
        clearTimeout(quiet);
        owner.signal.removeEventListener("abort", abort);
        connection.abort();
      }
      if (owner.signal.aborted) return;
      failures = healthy ? 0 : failures + 1;
      if (failures) await this.sleep(Math.min(1000 * 2 ** (failures - 1), RETRY_LIMIT_MS));
    }
  }

  /** True when the event changed something worth redrawing. */
  private handle(conversationId: string, event: SseEvent): boolean {
    if (event.type === "tool.started" || event.type === "tool.finished") {
      const data = JSON.parse(event.data) as Omit<ToolActivity, "state">;
      return this.applyStep({ ...data, state: event.type === "tool.started" ? "started" : "finished" });
    }
    if (event.type === "task.started" || event.type === "task.finished") {
      const data = JSON.parse(event.data) as Omit<TaskEvent, "state">;
      this.applyTask(conversationId, { ...data, state: event.type === "task.started" ? "started" : "finished" });
      return false; // applyTask emits itself
    }
    if (event.type === "task.needs_approval") {
      const data = JSON.parse(event.data) as { taskId: string; pendingApproval: PendingToolCall[] };
      const task = this.tasks.get(data.taskId);
      if (!task) return false;
      task.status = "needs_approval";
      task.pendingApproval = data.pendingApproval;
      task.updatedAt = new Date().toISOString();
      this.emit();
      this.ask(task.id);
      return false;
    }
    return false;
  }

  private applyTask(conversationId: string, event: TaskEvent): void {
    const now = new Date().toISOString();
    const known = this.tasks.get(event.taskId);
    const task: TaskView = known ?? {
      id: event.taskId,
      conversationId,
      description: event.description,
      status: "running",
      result: null,
      deliverProject: null,
      deliverPath: null,
      createdAt: now,
      updatedAt: now,
      steps: [],
    };
    task.description = event.description || task.description;
    task.updatedAt = now;
    if (event.state === "started") {
      // also how a task answered after waiting on the user is seen carrying on
      task.status = "running";
      task.pendingApproval = [];
      this.announced.add(task.id);
    } else {
      task.status = event.status === "failed" ? "failed" : "done";
      for (const step of task.steps) if (step.state === "running") step.state = "done";
    }
    this.tasks.set(task.id, task);
    this.emit();

    // the stream carries no result or delivery target: the task itself does
    void this.api
      .request<BackgroundTask>("GET", `/background-tasks/${event.taskId}`)
      .then((fresh) => {
        this.merge(fresh);
        this.emit();
      })
      .catch(() => {});
    if (event.state === "finished") this.announce(task);
  }

  private applyStep(tool: ToolActivity): boolean {
    if (!tool.taskId) return false;
    const task = this.tasks.get(tool.taskId);
    if (!task) return false;
    const existing = task.steps.find((step) => step.id === tool.id);
    const state = tool.state === "started" ? "running" : tool.failed ? "failed" : "done";
    if (existing) {
      // a replayed "started" must not undo a "finished" already applied
      if (existing.state !== "running" && state === "running") return false;
      existing.state = state;
      if (tool.args && !Object.keys(existing.args).length) existing.args = tool.args;
    } else {
      task.steps.push({ id: tool.id, name: tool.name, args: tool.args ?? {}, state, parentId: tool.parentId });
      if (task.steps.length > MAX_STEPS) task.steps.splice(0, task.steps.length - MAX_STEPS);
    }
    task.updatedAt = new Date().toISOString();
    return true;
  }

  private merge(fresh: BackgroundTask): void {
    const known = this.tasks.get(fresh.id);
    const wasLive = known !== undefined && live(known);
    // A read that left before the task ended can land after its task.finished: keep the end.
    if (known && !wasLive && live(fresh)) return;
    this.tasks.set(fresh.id, { ...fresh, steps: known?.steps ?? [] });
    if (live(fresh)) this.announced.add(fresh.id);
    else if (wasLive) this.announce(this.tasks.get(fresh.id)!);
  }

  private announce(task: TaskView): void {
    if (!this.announced.delete(task.id)) return;
    this.events.finished?.({ ...task, steps: [...task.steps] });
  }

  private hasRunning(conversationId: string): boolean {
    for (const task of this.tasks.values()) {
      if (task.conversationId === conversationId && live(task)) return true;
    }
    return false;
  }

  // While anything runs, the list is re-read now and then: a finish the stream missed, or a
  // task with no conversation to stream from, still lands.
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.stopped || ![...this.tasks.values()].some(live)) return;
    this.timer = setTimeout(() => void this.refresh().catch(() => this.schedule()), this.refreshEvery);
  }

  private emit(): void {
    this.events.changed(this.list());
  }
}
