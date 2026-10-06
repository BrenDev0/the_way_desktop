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
  /** Arguments the approver may pick, and the values allowed -- e.g. the image model. */
  choices?: Record<string, string[]>;
  /** A fuller description for the approval, when the tool has one. */
  preview?: string | null;
  /** Asked even in auto mode: it spends the user's money (an image). */
  alwaysAsk?: boolean;
}

export type ConversationStatus = "idle" | "running" | "awaiting_client" | "paused" | "failed";

export type PauseReason = "rate_limit" | "quota" | "timeout" | "provider_error" | "credentials" | "interrupted";

/** Why a turn stopped short. Everything it did is kept; resuming carries on from there. */
export interface TurnPause {
  reason: PauseReason;
  /** What the provider said, when it said something -- worth showing for quota and keys. */
  detail: string;
  pausedAt: string | null;
  /** Retrying before this is likely to pause again; null when the provider did not say. */
  retryAfter: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  client: "desktop" | "web";
  status: ConversationStatus;
  /** Set while status is "paused". */
  pause?: TurnPause | null;
  pendingToolCalls: PendingToolCall[];
  iterationsUsed: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
}

/** A file attached to a message: uploaded into the user's drafts project, where the
 *  agent works with it by its path. */
export interface Attachment {
  fileId: string;
  project: string;
  path: string;
  name: string;
  contentType: string;
  sizeBytes: number;
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
  /** The approver's picks among the call's choices. */
  args?: Record<string, string>;
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
  /** A GET whose answer is a file, not JSON. */
  bytes?(path: string): Promise<FileBytes>;
}

export interface FileBytes {
  data: Uint8Array;
  contentType: string;
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

/** needs_approval: stopped on a call only the user can approve; it carries on once they answer. */
export type TaskStatus = "running" | "needs_approval" | "done" | "failed";

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
  /** While needs_approval: the calls it waits on. Answered at POST .../{id}/approvals. */
  pendingApproval?: PendingToolCall[];
}

/** task.started / task.finished on the stream of the conversation that started the task. */
export interface TaskEvent {
  taskId: string;
  description: string;
  state: "started" | "finished";
  status?: TaskStatus;
}
