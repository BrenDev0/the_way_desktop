import { describe, expect, it } from "vitest";
import type { BackgroundTask, ConversationEventsPort, PendingToolCall, ServerApiPort } from "../../src/core/api";
import type { SseEvent } from "../../src/core/sse";
import { TaskMonitor } from "../../src/core/tasks/taskMonitor";
import { decidedResolution, type ApprovalDecision, type ApprovalRequest } from "../../src/core/tools/runner";

const FLARE = "gpt-image-2.5-flare";
const SUNBURST = "gpt-image-2.5-sunburst";

const images: PendingToolCall = {
  id: "c1",
  name: "GenerateImages",
  args: { project: "Borradores", images: [{ prompt: "banner" }], model: FLARE },
  location: "server",
  requiresApproval: true,
  detail: "generate 3 images into Borradores",
  choices: { model: [FLARE, SUNBURST] },
  preview: "1. banner.png",
};

function waiting(): BackgroundTask {
  return {
    id: "t1", conversationId: "conv", description: "Campaña de otoño", status: "needs_approval", result: null,
    deliverProject: null, deliverPath: null, createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z",
    pendingApproval: [images],
  };
}

const silent: ConversationEventsPort = { async *open(): AsyncIterable<SseEvent> {} };

class Server implements ServerApiPort {
  readonly posted: { path: string; body: unknown }[] = [];
  task = waiting();
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (method === "POST") {
      this.posted.push({ path, body });
      this.task = { ...this.task, status: "running", pendingApproval: [] };
      return this.task as T;
    }
    return (path === "/background-tasks" ? [this.task] : this.task) as T;
  }
}

class Person {
  readonly asked: ApprovalRequest[] = [];
  constructor(private readonly answer: ApprovalDecision) {}
  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    this.asked.push(request);
    return this.answer;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("a background task waiting on the user", () => {
  it("is asked once, with the task named, and carries on with the model picked", async () => {
    const api = new Server();
    const person = new Person({ approved: true, args: { model: SUNBURST } });
    const tasks = new TaskMonitor(api, silent, { changed: () => {} }, { approvals: person, refreshMilliseconds: 60_000 });

    await tasks.refresh();
    await tasks.refresh(); // heard again while the question is still open: not asked twice
    await settle();

    expect(person.asked).toHaveLength(1);
    expect(person.asked[0]).toMatchObject({ call: { id: "c1" }, preview: "1. banner.png", origin: "Campaña de otoño" });
    expect(api.posted).toEqual([
      { path: "/background-tasks/t1/approvals", body: { resolutions: [{ toolCallId: "c1", approved: true, args: { model: SUNBURST } }] } },
    ]);
    expect(tasks.list()[0].status).toBe("running");
    tasks.stop();
  });

  it("a question closed unanswered is not a refusal: nothing is sent and it is asked again", async () => {
    const api = new Server();
    const person = new Person({ approved: false, dismissed: true });
    const tasks = new TaskMonitor(api, silent, { changed: () => {} }, { approvals: person, refreshMilliseconds: 60_000 });

    await tasks.refresh();
    await settle();
    await tasks.refresh();
    await settle();

    expect(api.posted).toEqual([]);
    expect(person.asked).toHaveLength(2);
    tasks.stop();
  });
});

describe("decidedResolution", () => {
  it("sends only picks the call offers, and none on a refusal", () => {
    expect(decidedResolution(images, { approved: true, args: { model: "dall-e-3", other: "x" } })).toEqual({ toolCallId: "c1", approved: true });
    expect(decidedResolution(images, { approved: false, feedback: " no ", args: { model: SUNBURST } })).toEqual({
      toolCallId: "c1", approved: false, feedback: "no",
    });
  });
});
