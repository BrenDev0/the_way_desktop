/**
 * What the preload exposes to the window as `window.desktop`. The window gets verbs, never
 * the token, the file system or ipcRenderer itself: every call lands in a main-process
 * handler that checks it came from the app's own window.
 */

import type { AuthState } from "./auth";
import type { Attachment, ChatMessage, Conversation, PendingToolCall, ToolActivity } from "./api";
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
  /** A background task asking, by its description; absent for the chat's own calls. */
  origin?: string;
}

export interface ToolCheck {
  /** Desktop tools the server offers that this build cannot run. */
  missing: string[];
}

export type Unsubscribe = () => void;

/** Where the user works: a folder on this computer, or one in a project on the server. */
export interface WorkingPlace {
  mode: "local" | "remote";
  /** The folder open on this computer (the local tools' fence), whichever side is in use. */
  local: string | null;
  remote: { project: string; path: string } | null;
}

/** A file brought in to look at: from one of the user's projects, or the open folder. */
export interface ViewedFile {
  name: string;
  /** Project name, for a project file; absent for a local one. */
  project?: string;
  path: string;
  contentType: string;
  data: Uint8Array;
}

/** What to open in the viewer -- a file, or a folder for the files panel. */
export interface ViewTarget {
  project: string;
  path: string;
  kind: "file" | "folder";
}

export interface TextEvent {
  conversationId: string;
  text: string;
}

export interface ActivityEvent {
  conversationId: string;
  message?: ChatMessage;
  tool?: ToolActivity;
}

/** What the user picked: a theme, or whatever Windows is set to. */
export type ThemeChoice = "dark" | "light" | "system";

export interface Appearance {
  theme: ThemeChoice;
  /** The theme in effect -- "system" settled to one of the two. */
  resolved: "dark" | "light";
}

export interface DesktopBridge {
  connection: ServerConnectionPort;
  appearance: {
    get(): Promise<Appearance>;
    set(theme: ThemeChoice): Promise<Appearance>;
    /** Every window hears it: the user chose another, or Windows switched under "system". */
    onChange(listener: (appearance: Appearance) => void): Unsubscribe;
  };
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
    /** Where the user works now, local or remote. */
    place(): Promise<WorkingPlace>;
    /** A project folder on the server becomes where they work ("" is its top level). */
    setRemote(project: string, path: string): Promise<WorkingPlace>;
    /** Switch back to a side already chosen. */
    use(mode: "local" | "remote"): Promise<WorkingPlace>;
  };
  conversations: {
    list(): Promise<Conversation[]>;
    create(title: string): Promise<Conversation>;
    messages(conversationId: string): Promise<ChatMessage[]>;
    /** Resolves when the turn is over; progress arrives through onUpdate meanwhile.
     *  `voice`: the reply will be spoken, so it should be written to be heard. */
    send(conversationId: string, message: string, voice?: boolean, attachments?: string[]): Promise<Conversation>;
    /** Uploads a file to attach to the next message; send its fileId with it. */
    attach(name: string, contentType: string, data: Uint8Array): Promise<Attachment>;
    /** Picks up a conversation left mid-turn. */
    resume(conversationId: string): Promise<Conversation>;
    /** Carries on a paused turn (a rate limit, a timeout...) from where it stopped, and
     *  resolves when it is over again. */
    retry(conversationId: string): Promise<Conversation>;
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
    /** Questions answered without the window (auto mode switched on): take them down. */
    onSettled(listener: (ids: string[]) => void): Unsubscribe;
    /** Auto mode: approve everything except calls that must always ask (images). */
    auto(): Promise<boolean>;
    setAuto(on: boolean): Promise<boolean>;
    onAutoChanged(listener: (on: boolean) => void): Unsubscribe;
  };
  tools: {
    check(): Promise<ToolCheck>;
  };
  /** Looking at what the agent made: fetch a file, save a copy, or hand it to the system. */
  viewer: {
    project(projectName: string, path: string): Promise<ViewedFile>;
    local(path: string): Promise<ViewedFile>;
    /** Asks where to save it; resolves with where it went, or null if cancelled. */
    save(name: string, data: Uint8Array): Promise<string | null>;
    /** Opens it in the program the system uses for that kind of file. */
    openExternal(name: string, data: Uint8Array): Promise<void>;
    /** The task strip asked to show something; the window opens it. */
    onShow(listener: (target: ViewTarget) => void): Unsubscribe;
  };
  /** A link from a reply, opened in the system browser (http, https and mailto only). */
  links: {
    open(url: string): Promise<void>;
  };
  /** Speech through the server, on the user's OpenAI key. */
  voice: {
    /** A 16 kHz mono wav recording, as text; empty when nothing was said. */
    transcribe(wav: Uint8Array): Promise<string>;
    /** The text spoken, as raw 16-bit mono pcm at 24 kHz, handed to `chunk` as it streams
     *  in; resolves once all of it has arrived. A chunk may end mid-sample. */
    speak(text: string, chunk: (pcm: Uint8Array) => void): Promise<void>;
    /** Voice was turned on: get the connection to the speech service ready. */
    warm(): Promise<void>;
  };
  /**
   * The task icons on the screen edge. The dock window uses the first group; the main
   * window only hears what the dock asks it to open.
   */
  dock: {
    /** The docked tasks, oldest first. */
    tasks(): Promise<TaskView[]>;
    onTasks(listener: (tasks: TaskView[]) => void): Unsubscribe;
    /** Puts a finished task's icon away. */
    dismiss(taskId: string): Promise<void>;
    /** Whether the pointer is over an icon or card: the rest of the strip lets clicks
     *  through to whatever is behind it. */
    interactive(on: boolean): void;
    /** Brings the app forward on a task's delivered folder, or its conversation. */
    openProject(name: string, path: string | null): void;
    openConversation(conversationId: string): void;
    /** Brings the app forward on the approval a task waits on, asking again if it was closed. */
    review(): void;
    /** Brings the app forward showing one of the task's files. */
    show(target: ViewTarget): void;
    /** Answers what a task waits on, right from the strip: one decision for each call. */
    approve(taskId: string, decisions: { callId: string; approved: boolean; args?: Record<string, string> }[]): Promise<void>;
    /** A small picture of an image the task made, for its tile. */
    thumbnail(project: string, path: string): Promise<{ data: Uint8Array; contentType: string } | null>;
    onOpenProject(listener: (target: { name: string; path: string | null }) => void): Unsubscribe;
    onOpenConversation(listener: (conversationId: string) => void): Unsubscribe;
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
  appearanceGet: "appearance:get",
  appearanceSet: "appearance:set",
  appearanceChanged: "appearance:changed",
  authState: "auth:state",
  authLogin: "auth:login",
  authLogout: "auth:logout",
  authSignedOut: "auth:signed-out",
  workspaceCurrent: "workspace:current",
  workspaceChoose: "workspace:choose",
  workspacePlace: "workspace:place",
  workspaceSetRemote: "workspace:set-remote",
  workspaceUse: "workspace:use",
  conversationsList: "conversations:list",
  conversationsCreate: "conversations:create",
  conversationsMessages: "conversations:messages",
  conversationsSend: "conversations:send",
  conversationsAttach: "conversations:attach",
  conversationsResume: "conversations:resume",
  conversationsRetry: "conversations:retry",
  conversationsRemove: "conversations:remove",
  conversationsUpdate: "conversations:update",
  conversationsText: "conversations:text",
  conversationsActivity: "conversations:activity",
  approvalsRequest: "approvals:request",
  approvalsRespond: "approvals:respond",
  approvalsSettled: "approvals:settled",
  approvalsAuto: "approvals:auto",
  approvalsSetAuto: "approvals:set-auto",
  approvalsAutoChanged: "approvals:auto-changed",
  toolsCheck: "tools:check",
  voiceTranscribe: "voice:transcribe",
  voiceSpeak: "voice:speak",
  /** main -> window: a piece of the audio a voiceSpeak call is streaming, by its stream id */
  voiceChunk: "voice:chunk",
  voiceWarm: "voice:warm",
  dockTasks: "dock:tasks",
  dockTasksChanged: "dock:tasks-changed",
  dockDismiss: "dock:dismiss",
  dockInteractive: "dock:interactive",
  dockOpenProject: "dock:open-project",
  dockOpenConversation: "dock:open-conversation",
  dockReview: "dock:review",
  dockApprove: "dock:approve",
  dockThumbnail: "dock:thumbnail",
  linksOpen: "links:open",
  viewerShow: "viewer:show",
  viewerProject: "viewer:project",
  viewerLocal: "viewer:local",
  viewerSave: "viewer:save",
  viewerOpenExternal: "viewer:open-external",
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
