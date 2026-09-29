/** The server's desktop API (`/api/desktop/v1`), as the rest of the app sees it. */

import type { SseEvent } from "./sse";

export type Role = "owner" | "admin" | "member";

export interface DesktopUser {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  setupComplete: boolean;
  createdAt: string;
}

export type ToolLocation = "server" | "desktop";

/** A tool call the conversation is paused on. Desktop calls are run here; server calls
 *  only need the user's approval, and the server runs them. */
export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  location: ToolLocation;
  requiresApproval: boolean;
  detail: string | null;
}

export type ConversationStatus = "idle" | "running" | "awaiting_client" | "failed";

export interface Conversation {
  id: string;
  title: string;
  client: "desktop" | "web";
  status: ConversationStatus;
  pendingToolCalls: PendingToolCall[];
  iterationsUsed: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[] | null;
  toolCallId?: string | null;
}

export interface ToolResolution {
  toolCallId: string;
  approved: boolean;
  feedback?: string;
  /** What a desktop tool returned. Required when approving a desktop call. */
  output?: string | null;
  failed?: boolean;
}

/** An error the server answered with: `{ message, code }` and the HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Authenticated calls to the desktop API. The adapter adds the base URL and token. */
export interface ServerApiPort {
  request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T>;
}

/** A conversation's live events (GET /conversations/{id}/events), until the stream ends
 *  or the signal aborts. `lastEventId` resumes after the last event already seen. */
export interface ConversationEventsPort {
  open(conversationId: string, lastEventId: string | undefined, signal: AbortSignal): AsyncIterable<SseEvent>;
}

/** A tool the server is running for the agent, as the stream reports it. */
export interface ToolActivity {
  id: string;
  name: string;
  state: "started" | "finished";
  failed?: boolean;
  /** Sent with tool.started only. */
  args?: Record<string, unknown>;
  /** The call this one runs inside (BuildHtmlPage's designer and builder, BuildSkill's writer). */
  parentId?: string;
  /** Set when a background task made the call, not the reply. */
  taskId?: string;
}

export type TaskStatus = "running" | "done" | "failed";

/** GET /background-tasks and /background-tasks/{id}: a task the user's agent started. */
export interface BackgroundTask {
  id: string;
  conversationId: string | null;
  description: string;
  status: TaskStatus;
  result: string | null;
  /** Where the finished work is delivered, e.g. project "test_report", path "reports". */
  deliverProject: string | null;
  deliverPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** task.started / task.finished on the stream of the conversation that started the task. */
export interface TaskEvent {
  taskId: string;
  description: string;
  state: "started" | "finished";
  status?: TaskStatus;
}
