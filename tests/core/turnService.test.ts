import { describe, expect, it } from "vitest";
import {
  ApiError,
  type ChatMessage,
  type Conversation,
  type ConversationEventsPort,
  type PendingToolCall,
  type ServerApiPort,
  type ToolActivity,
} from "../../src/core/api";
import { TurnService } from "../../src/core/conversations/turnService";
import type { SseEvent } from "../../src/core/sse";
import type { ToolRegistry } from "../../src/core/tools/contract";
import { ToolRunner, type ApprovalRequest } from "../../src/core/tools/runner";

function call(overrides: Partial<PendingToolCall> = {}): PendingToolCall {
  return { id: "c1", name: "ReadFile", args: { file_path: "notes.txt" }, location: "desktop", requiresApproval: false, detail: null, ...overrides };
}

function conversation(status: Conversation["status"], pending: PendingToolCall[] = []): Conversation {
  return {
    id: "conv", title: "t", client: "desktop", status, pendingToolCalls: pending,
    iterationsUsed: 0, totalTokens: 0, createdAt: "", updatedAt: "",
  };
}

const status = (c: Conversation, id?: string): SseEvent => ({ id, type: "status", data: JSON.stringify(c) });
const text = (t: string, id: string): SseEvent => ({ id, type: "text", data: JSON.stringify({ text: t }) });

/** Each open() plays the next scripted connection: its events, then an end or an error. */
class ScriptedStream implements ConversationEventsPort {
  readonly opened: (string | undefined)[] = [];
  constructor(private readonly connections: (SseEvent[] | Error)[]) {}

  async *open(_id: string, lastEventId: string | undefined, signal: AbortSignal): AsyncIterable<SseEvent> {
    this.opened.push(lastEventId);
    const next = this.connections.shift() ?? [status(conversation("idle"))];
    if (next instanceof Error) throw next;
    for (const event of next) {
      if (signal.aborted) return;
      yield event;
    }
  }
}

class Api implements ServerApiPort {
  readonly posted: { path: string; body: unknown }[] = [];
  failNextToolResults: Error | null = null;

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (method === "POST" && path.endsWith("/tool-results") && this.failNextToolResults) {
      const error = this.failNextToolResults;
      this.failNextToolResults = null;
      throw error;
    }
    this.posted.push({ path, body });
    return conversation("running") as T;
  }
}

class Approvals {
  readonly asked: ApprovalRequest[] = [];
  async request(request: ApprovalRequest) {
    this.asked.push(request);
    return { approved: true };
  }
}

function service(stream: ConversationEventsPort, api = new Api(), registry?: ToolRegistry) {
  let runs = 0;
  const tools: ToolRegistry = registry ?? {
    ReadFile: { run: async (args) => { runs += 1; return `contents of ${args.file_path}`; } },
    DeleteFile: { run: async () => { runs += 1; return "deleted"; } },
  };
  const approvals = new Approvals();
  const seen = { statuses: [] as string[], text: "", messages: [] as ChatMessage[], tools: [] as ToolActivity[] };
  const turns = new TurnService(api, stream, new ToolRunner(tools, approvals), {
    update: (c) => seen.statuses.push(c.status),
    text: (_id, t) => { seen.text += t; },
    message: (_id, m) => seen.messages.push(m),
    activity: (_id, a) => seen.tools.push(a),
  }, { sleep: async () => {} });
  return { turns, api, approvals, seen, runs: () => runs };
}

describe("TurnService over the event stream", () => {
  it("relays streamed text and finishes on idle", async () => {
    const stream = new ScriptedStream([[
      status(conversation("running")),
      text("Hello", "1-0"),
      text(" there", "2-0"),
      { id: "3-0", type: "message", data: JSON.stringify({ role: "assistant", content: "Hello there" }) },
      status(conversation("idle"), "4-0"),
    ]]);
    const { turns, seen } = service(stream);

    const finished = await turns.send("conv", "hi");

    expect(finished.status).toBe("idle");
    expect(seen.text).toBe("Hello there");
    expect(seen.messages).toEqual([{ role: "assistant", content: "Hello there" }]);
  });

  it("settles a pause off-stream, posts the answers, and resumes after the last event", async () => {
    const stream = new ScriptedStream([
      [status(conversation("running")), text("Let me look", "1-0"), status(conversation("awaiting_client", [call()]), "2-0")],
      [status(conversation("running")), status(conversation("idle"), "3-0")],
    ]);
    const { turns, api } = service(stream);

    await turns.send("conv", "what is in notes.txt?");

    expect(api.posted[1]).toEqual({
      path: "/conversations/conv/tool-results",
      body: { resolutions: [{ toolCallId: "c1", approved: true, output: "contents of notes.txt" }] },
    });
    expect(stream.opened).toEqual([undefined, "2-0"]);
  });

  it("tells the server which folder is open, read afresh for every message and resume", async () => {
    const stream = new ScriptedStream([
      [status(conversation("awaiting_client", [call()]), "1-0")],
      [status(conversation("idle"), "2-0")],
      [status(conversation("idle"), "3-0")],
    ]);
    const api = new Api();
    let folder: string | null = null;
    const turns = new TurnService(api, stream, new ToolRunner({ ReadFile: { run: async () => "x" } }, { request: async () => ({ approved: true }) }), {
      update: () => {},
    }, { sleep: async () => {}, folder: async () => folder });

    await turns.send("conv", "crea prueba__2");
    folder = "C:/Users/Xplorers/Desktop";
    await turns.send("conv", "ya está abierta");

    // none open is said as "", so the agent is told -- the old app said nothing at all
    expect(api.posted.map((p) => (p.body as { localFolder?: string }).localFolder)).toEqual(["", "", "C:/Users/Xplorers/Desktop"]);
  });

  it("says the project folder instead when the user works on the server", async () => {
    const stream = new ScriptedStream([[status(conversation("idle"), "1-0")]]);
    const api = new Api();
    const turns = new TurnService(api, stream, new ToolRunner({}, { request: async () => ({ approved: true }) }), {
      update: () => {},
    }, { sleep: async () => {}, folder: async () => "C:/Users/me/Desktop", remote: async () => "cx/nuevo_prueba" });

    await turns.send("conv", "crea un archivo aquí");

    expect(api.posted[0].body).toMatchObject({ remoteFolder: "cx/nuevo_prueba" });
    expect(api.posted[0].body).not.toHaveProperty("localFolder");
  });

  it("asks for a spoken reply on send and again on every resume of that turn", async () => {
    const stream = new ScriptedStream([
      [status(conversation("awaiting_client", [call()]), "1-0")],
      [status(conversation("idle"), "2-0")],
      [status(conversation("awaiting_client", [call({ id: "c2" })]), "3-0")],
      [status(conversation("idle"), "4-0")],
    ]);
    const { turns, api } = service(stream);

    await turns.send("conv", "what is in notes.txt?", true);
    await turns.send("conv", "and now?");

    expect(api.posted.map((p) => (p.body as { voice?: boolean }).voice)).toEqual([true, true, undefined, undefined]);
  });

  it("reports server tool activity", async () => {
    const stream = new ScriptedStream([[
      { id: "1-0", type: "tool.started", data: JSON.stringify({ id: "t1", name: "ListProjects", args: {} }) },
      { id: "2-0", type: "tool.finished", data: JSON.stringify({ id: "t1", name: "ListProjects", failed: false }) },
      status(conversation("idle"), "3-0"),
    ]]);
    const { turns, seen } = service(stream);

    await turns.drive("conv");

    expect(seen.tools.map((t) => t.state)).toEqual(["started", "finished"]);
  });

  it("reconnects after a dropped connection, from the last event seen", async () => {
    const stream = new ScriptedStream([
      [status(conversation("running")), text("partial", "5-0")],
      new ApiError(0, "unreachable", "The server could not be reached."),
      [status(conversation("idle"), "6-0")],
    ]);
    const { turns } = service(stream);

    expect((await turns.drive("conv")).status).toBe("idle");
    expect(stream.opened).toEqual([undefined, "5-0", "5-0"]);
  });

  it("does not ask twice about calls it already answered, when a stale status replays", async () => {
    const paused = conversation("awaiting_client", [call()]);
    const stream = new ScriptedStream([
      [status(paused, "1-0")],
      // a replay of the pause from before the answers landed
      [status(paused), status(conversation("idle"), "2-0")],
    ]);
    const { turns, api, runs } = service(stream);

    await turns.drive("conv");

    expect(runs()).toBe(1);
    expect(api.posted.filter((p) => p.path.endsWith("/tool-results"))).toHaveLength(1);
  });

  it("re-sends the same answers when posting them failed -- never runs the tool again", async () => {
    const paused = conversation("awaiting_client", [call({ name: "DeleteFile", requiresApproval: true })]);
    const api = new Api();
    api.failNextToolResults = new ApiError(0, "unreachable", "The server could not be reached.");
    const stream = new ScriptedStream([[status(paused, "1-0")], [status(paused, "1-0")], [status(conversation("idle"), "2-0")]]);
    const { turns, approvals, runs } = service(stream, api);

    await turns.drive("conv");

    expect(runs()).toBe(1);
    expect(approvals.asked).toHaveLength(1);
    expect(api.posted.filter((p) => p.path.endsWith("/tool-results"))).toHaveLength(1);
  });

  it("gives up at once when signed out", async () => {
    const stream = new ScriptedStream([new ApiError(401, "invalid_session", "Invalid session")]);
    const { turns } = service(stream);

    await expect(turns.drive("conv")).rejects.toMatchObject({ status: 401 });
  });

  it("presumes a silent stream dead and reopens it", async () => {
    let first = true;
    const stream: ConversationEventsPort & { opened: number } = {
      opened: 0,
      async *open(_id, _last, signal) {
        this.opened += 1;
        if (first) {
          first = false;
          yield status(conversation("running"));
          // nothing more, not even a keep-alive, until the watchdog gives up on it
          await new Promise((resolve) => signal.addEventListener("abort", resolve));
          return;
        }
        yield status(conversation("idle"), "1-0");
      },
    };
    const api = new Api();
    const turns = new TurnService(api, stream, new ToolRunner({}, new Approvals()), { update: () => {} }, {
      silenceMilliseconds: 50,
      sleep: async () => {},
    });

    expect((await turns.drive("conv")).status).toBe("idle");
    expect(stream.opened).toBe(2);
  });

  it("shares one drive between two callers", async () => {
    const stream = new ScriptedStream([[status(conversation("idle"), "1-0")]]);
    const { turns } = service(stream);

    const [a, b] = await Promise.all([turns.drive("conv"), turns.drive("conv")]);

    expect(a).toBe(b);
    expect(stream.opened).toHaveLength(1);
  });
});
