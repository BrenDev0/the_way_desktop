import {
  ApiError,
  type ChatMessage,
  type Conversation,
  type ConversationEventsPort,
  type ServerApiPort,
  type TaskEvent,
  type ToolActivity,
  type ToolResolution,
} from "../api";
import type { SseEvent } from "../sse";
import type { ToolRunner } from "../tools/runner";

export interface TurnEvents {
  /** Every change worth redrawing: status, pending calls, a finished turn. */
  update(conversation: Conversation): void;
  /** A piece of the assistant's reply, as the model writes it. */
  text?(conversationId: string, text: string): void;
  /** A message the turn added -- the assistant's, or a tool result (clipped). */
  message?(conversationId: string, message: ChatMessage): void;
  /** A server-side tool starting or finishing -- the reply's, or a background task's (taskId set). */
  activity?(conversationId: string, activity: ToolActivity): void;
  /** A background task this conversation started began or ended. `eventId` is where the
   *  stream stood, so whoever watches the task after the turn can carry on from there. */
  task?(conversationId: string, task: TaskEvent, eventId: string | undefined): void;
}

export interface TurnOptions {
  /** How long the stream may stay silent before it is presumed dead. The server sends a
   *  keep-alive every 15 seconds, so this is three missed in a row. */
  silenceMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** The folder open in the app now, or null. Read afresh for every message and resume,
   *  and told to the server, so the agent knows where its local tools work -- the user
   *  can open one, or switch, between any two messages. */
  folder?: () => Promise<string | null>;
  /** The project folder on the server the user works in ("project/folder"), when that is
   *  the side in use; null when it is the local folder. Takes the local folder's place. */
  remote?: () => Promise<string | null>;
}

const RETRY_LIMIT_MS = 10_000;
const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** The stream said the turn is waiting on this machine; drive() settles it off-stream. */
class Paused {
  constructor(readonly conversation: Conversation) {}
}

/**
 * Drives a conversation from the desktop side, over the server's event stream.
 *
 * The server does the thinking and publishes what happens -- status changes, reply text as
 * it is written, tool activity. This follows that stream; whenever the turn pauses on tool
 * calls it closes the stream, has the runner settle every call (run here, approved, or
 * refused -- which can mean waiting on the user), posts the answers back in one go, and
 * reopens the stream after the last event it saw. One turn can pause many times.
 */
export class TurnService {
  private readonly inFlight = new Map<string, Promise<Conversation>>();
  private readonly silence: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly api: ServerApiPort,
    private readonly stream: ConversationEventsPort,
    private readonly runner: ToolRunner,
    private readonly events: TurnEvents,
    options: TurnOptions = {},
  ) {
    this.silence = options.silenceMilliseconds ?? 45_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.folder = options.folder;
    this.remote = options.remote;
  }

  private readonly folder: (() => Promise<string | null>) | undefined;
  private readonly remote: (() => Promise<string | null>) | undefined;

  /** Where the user works, for a request body: `{ remoteFolder }` when it is a project
   *  folder on the server, else `{ localFolder }` -- the open folder, "" for none. */
  private async where(): Promise<{ localFolder?: string; remoteFolder?: string }> {
    const remote = await this.remote?.().catch(() => null);
    if (remote) return { remoteFolder: remote };
    if (!this.folder) return {};
    return { localFolder: (await this.folder().catch(() => null)) ?? "" };
  }

  list(): Promise<Conversation[]> {
    return this.api.request("GET", "/conversations");
  }

  create(title: string): Promise<Conversation> {
    return this.api.request("POST", "/conversations", { title, client: "desktop" });
  }

  messages(conversationId: string): Promise<ChatMessage[]> {
    return this.api.request("GET", `/conversations/${conversationId}/messages`);
  }

  remove(conversationId: string): Promise<unknown> {
    return this.api.request("DELETE", `/conversations/${conversationId}`);
  }

  /** `voice`: the reply will be spoken aloud, so the server asks for one written to be heard. */
  async send(conversationId: string, message: string, voice = false): Promise<Conversation> {
    const started = await this.api.request<Conversation>("POST", `/conversations/${conversationId}/messages`, {
      message,
      ...(voice ? { voice: true } : {}),
      ...(await this.where()),
    });
    this.events.update(started);
    // the server keeps no record of it, so every resume of this turn has to say it again
    // a new message is a new run: whatever the last reply was allowed does not carry over
    this.runs.set(conversationId, `${conversationId}:${++this.sent}`);
    if (voice) this.voice.add(conversationId);
    else this.voice.delete(conversationId);
    return this.drive(conversationId);
  }

  /**
   * Follows a turn to its end. Safe to call on any conversation -- opening one that was
   * left paused (the app closed mid-turn) picks it up where it stopped -- and a second
   * call for a conversation already being driven shares the first one's result.
   */
  drive(conversationId: string): Promise<Conversation> {
    const existing = this.inFlight.get(conversationId);
    if (existing) return existing;
    const running = this.follow(conversationId).finally(() => this.inFlight.delete(conversationId));
    this.inFlight.set(conversationId, running);
    return running;
  }

  private async follow(conversationId: string): Promise<Conversation> {
    let lastEventId: string | undefined;
    let failures = 0;
    // Answers already posted: a status replayed from before they landed must not ask twice.
    const answered = new Set<string>();

    for (;;) {
      try {
        const outcome = await this.watch(conversationId, lastEventId, answered, (id) => { lastEventId = id; });
        failures = 0;
        if (outcome instanceof Paused) {
          await this.settle(conversationId, outcome.conversation, answered);
          continue;
        }
        if (outcome) return outcome;
        // the server ends a stream after a while; carry on from the last event seen
      } catch (error) {
        // signed out, or the conversation is gone: no retry will change that
        if (error instanceof ApiError && (error.status === 401 || error.status === 404)) throw error;
        failures += 1;
        await this.sleep(Math.min(1000 * 2 ** (failures - 1), RETRY_LIMIT_MS));
      }
    }
  }

  /** Reads one connection's events. Resolves with the finished conversation, a pause to
   *  settle, or undefined when the stream ended and should be reopened. */
  private async watch(
    conversationId: string,
    lastEventId: string | undefined,
    answered: Set<string>,
    seen: (id: string) => void,
  ): Promise<Conversation | Paused | undefined> {
    const controller = new AbortController();
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const listen = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => controller.abort(), this.silence);
    };

    listen();
    try {
      for await (const event of this.stream.open(conversationId, lastEventId, controller.signal)) {
        listen();
        if (event.id) seen(event.id);
        const outcome = this.handle(conversationId, event, answered);
        if (outcome) return outcome;
      }
      return undefined;
    } finally {
      clearTimeout(quiet);
      controller.abort();
    }
  }

  private handle(conversationId: string, event: SseEvent, answered: Set<string>): Conversation | Paused | undefined {
    const data: unknown = JSON.parse(event.data);

    if (event.type === "status") {
      const conversation = data as Conversation;
      this.events.update(conversation);
      if (conversation.status === "idle" || conversation.status === "failed") return conversation;
      const pending = conversation.pendingToolCalls;
      if (conversation.status === "awaiting_client" && pending.length && pending.every((call) => !answered.has(call.id))) {
        return new Paused(conversation);
      }
      return undefined;
    }

    if (event.type === "text") this.events.text?.(conversationId, (data as { text: string }).text);
    else if (event.type === "message") this.events.message?.(conversationId, data as ChatMessage);
    else if (event.type === "tool.started" || event.type === "tool.finished") {
      const { id, name, failed, args, parentId, taskId } = data as Omit<ToolActivity, "state">;
      this.events.activity?.(conversationId, {
        id,
        name,
        state: event.type === "tool.started" ? "started" : "finished",
        failed,
        args,
        parentId,
        taskId,
      });
    } else if (event.type === "task.started" || event.type === "task.finished") {
      const { taskId, description, status } = data as Omit<TaskEvent, "state">;
      this.events.task?.(
        conversationId,
        { taskId, description, status, state: event.type === "task.started" ? "started" : "finished" },
        event.id,
      );
    }
    return undefined;
  }

  private async settle(conversationId: string, paused: Conversation, answered: Set<string>): Promise<void> {
    // A call is run (or asked about) once. If posting the answers fails and the pause is
    // seen again, the same answers are sent again -- never a second delete, never the same
    // approval asked twice.
    const unsettled = paused.pendingToolCalls.filter((call) => !this.settled.has(call.id));
    // a turn picked up after a restart is a run of its own
    const run = this.runs.get(conversationId) ?? `${conversationId}:${++this.sent}`;
    this.runs.set(conversationId, run);
    for (const resolution of await this.runner.resolveAll(unsettled, run)) {
      this.settled.set(resolution.toolCallId, resolution);
    }
    const resolutions = paused.pendingToolCalls.map((call) => this.settled.get(call.id)!);

    try {
      const resumed = await this.api.request<Conversation>("POST", `/conversations/${conversationId}/tool-results`, {
        resolutions,
        ...(this.voice.has(conversationId) ? { voice: true } : {}),
        ...(await this.where()),
      });
      this.events.update(resumed);
    } catch (error) {
      // Someone else answered first (another window, a retry that did land): the stream
      // will say where things stand now.
      if (!(error instanceof ApiError && error.code === "conversation_not_awaiting_client")) throw error;
    }
    for (const call of paused.pendingToolCalls) {
      answered.add(call.id);
      this.settled.delete(call.id);
    }
  }

  private readonly settled = new Map<string, ToolResolution>();
  /** Conversations whose current turn was spoken. */
  private readonly voice = new Set<string>();
  /** The run each conversation is on: one per message sent. */
  private readonly runs = new Map<string, string>();
  private sent = 0;
}
