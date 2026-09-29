/**
 * What the preload exposes to the window as `window.desktop`. The window gets verbs, never
 * the token, the file system or ipcRenderer itself: every call lands in a main-process
 * handler that checks it came from the app's own window.
 */

import type { AuthState } from "./auth";
import type { ChatMessage, Conversation, PendingToolCall, ToolActivity } from "./api";
import type { ServerConnectionPort } from "./connection";
import type { TaskView } from "./tasks/taskMonitor";
import type { ProjectRef, RemoteTree } from "./tools/ports";
import type { ApprovalDecision } from "./tools/runner";
import type { DownloadResult, UploadResult } from "./tools/transfer";
import type { LocalEntry } from "./workspace/localFiles";

export interface ApprovalPrompt {
  id: string;
  call: PendingToolCall;
  preview?: string;
}

export interface ToolCheck {
  /** Desktop tools the server offers that this build cannot run. */
  missing: string[];
}

export type Unsubscribe = () => void;

export interface TextEvent {
  conversationId: string;
  text: string;
}

export interface ActivityEvent {
  conversationId: string;
  message?: ChatMessage;
  tool?: ToolActivity;
}

export interface DesktopBridge {
  connection: ServerConnectionPort;
  auth: {
    state(): Promise<AuthState>;
    login(email: string, password: string): Promise<AuthState>;
    logout(): Promise<AuthState>;
    onSignedOut(listener: () => void): Unsubscribe;
  };
  workspace: {
    /** The folder the local file tools work in, or null before one is chosen. */
    current(): Promise<string | null>;
    choose(): Promise<string | null>;
  };
  conversations: {
    list(): Promise<Conversation[]>;
    create(title: string): Promise<Conversation>;
    messages(conversationId: string): Promise<ChatMessage[]>;
    /** Resolves when the turn is over; progress arrives through onUpdate meanwhile. */
    send(conversationId: string, message: string): Promise<Conversation>;
    /** Picks up a conversation left mid-turn. */
    resume(conversationId: string): Promise<Conversation>;
    remove(conversationId: string): Promise<void>;
    onUpdate(listener: (conversation: Conversation) => void): Unsubscribe;
    /** The assistant's reply as it is written, a piece at a time. */
    onText(listener: (event: TextEvent) => void): Unsubscribe;
    /** Messages the turn adds and server tools starting or finishing, as they happen. */
    onActivity(listener: (event: ActivityEvent) => void): Unsubscribe;
  };
  approvals: {
    onRequest(listener: (prompt: ApprovalPrompt) => void): Unsubscribe;
    respond(id: string, decision: ApprovalDecision): Promise<void>;
  };
  tools: {
    check(): Promise<ToolCheck>;
  };
  /** The user's background tasks, with the tool calls seen while the app watched them. */
  tasks: {
    /** Reads the list afresh (and starts following running tasks). */
    list(): Promise<TaskView[]>;
    onChanged(listener: (tasks: TaskView[]) => void): Unsubscribe;
  };
  /** The open folder, for the files panel. Paths are relative to it, "/"-separated; "" is the folder itself. */
  files: {
    list(folder: string): Promise<LocalEntry[]>;
    /** Each resolves with the entry's new path. */
    createFolder(parent: string, name: string): Promise<string>;
    rename(path: string, name: string): Promise<string>;
    move(path: string, folder: string): Promise<string>;
    remove(path: string): Promise<void>;
    /** Shows the entry in Explorer / Finder. */
    reveal(path: string): Promise<void>;
  };
  /** The user's projects on the server. Local work goes up only when the user uploads it. */
  projects: {
    list(): Promise<ProjectRef[]>;
    create(name: string): Promise<ProjectRef>;
    tree(projectId: string): Promise<RemoteTree>;
    /** Uploads a local file or folder; files already in the project are skipped, never replaced. */
    upload(localPath: string, project: string, destination: string): Promise<UploadResult>;
    /** Downloads a project path ("" for all of it) into a local folder. */
    download(project: string, path: string, localFolder: string): Promise<DownloadResult>;
    removeEntry(projectId: string, kind: "file" | "folder", id: string): Promise<void>;
  };
}

/** IPC channel names, in one place so the preload and the handlers cannot drift. */
export const CHANNELS = {
  authState: "auth:state",
  authLogin: "auth:login",
  authLogout: "auth:logout",
  authSignedOut: "auth:signed-out",
  workspaceCurrent: "workspace:current",
  workspaceChoose: "workspace:choose",
  conversationsList: "conversations:list",
  conversationsCreate: "conversations:create",
  conversationsMessages: "conversations:messages",
  conversationsSend: "conversations:send",
  conversationsResume: "conversations:resume",
  conversationsRemove: "conversations:remove",
  conversationsUpdate: "conversations:update",
  conversationsText: "conversations:text",
  conversationsActivity: "conversations:activity",
  approvalsRequest: "approvals:request",
  approvalsRespond: "approvals:respond",
  toolsCheck: "tools:check",
  tasksList: "tasks:list",
  tasksChanged: "tasks:changed",
  filesList: "files:list",
  filesCreateFolder: "files:create-folder",
  filesRename: "files:rename",
  filesMove: "files:move",
  filesRemove: "files:remove",
  filesReveal: "files:reveal",
  projectsList: "projects:list",
  projectsCreate: "projects:create",
  projectsTree: "projects:tree",
  projectsUpload: "projects:upload",
  projectsDownload: "projects:download",
  projectsRemoveEntry: "projects:remove-entry",
} as const;
