import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AuthState } from "../core/auth";
import type { ChatMessage, Conversation } from "../core/api";
import {
  CHANNELS,
  type ActivityEvent,
  type Appearance,
  type ApprovalPrompt,
  type DesktopBridge,
  type TextEvent,
  type ToolCheck,
  type Unsubscribe,
  type ViewedFile,
  type ViewTarget,
  type WorkingPlace,
} from "../core/bridge";
import type { ConnectionResult, ServerConnectionPort, ServerSettings } from "../core/connection";
import type { ApprovalDecision } from "../core/tools/runner";

const connection: ServerConnectionPort = {
  load: () => ipcRenderer.invoke("connection:load") as Promise<ServerSettings>,
  connect: (baseUrl: string) => ipcRenderer.invoke("connection:connect", baseUrl) as Promise<ConnectionResult>,
  check: (baseUrl: string) => ipcRenderer.invoke("connection:check", baseUrl) as Promise<ConnectionResult>,
};

/** Subscribes to one event channel; the window never gets ipcRenderer itself. */
function listen<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const desktop: DesktopBridge = {
  connection,
  appearance: {
    get: () => ipcRenderer.invoke(CHANNELS.appearanceGet) as Promise<Appearance>,
    set: (theme) => ipcRenderer.invoke(CHANNELS.appearanceSet, theme) as Promise<Appearance>,
    onChange: (listener) => listen<Appearance>(CHANNELS.appearanceChanged, listener),
  },
  auth: {
    state: () => ipcRenderer.invoke(CHANNELS.authState) as Promise<AuthState>,
    login: (email, password) => ipcRenderer.invoke(CHANNELS.authLogin, email, password) as Promise<AuthState>,
    logout: () => ipcRenderer.invoke(CHANNELS.authLogout) as Promise<AuthState>,
    onSignedOut: (listener) => listen(CHANNELS.authSignedOut, () => listener()),
  },
  workspace: {
    current: () => ipcRenderer.invoke(CHANNELS.workspaceCurrent) as Promise<string | null>,
    choose: () => ipcRenderer.invoke(CHANNELS.workspaceChoose) as Promise<string | null>,
    place: () => ipcRenderer.invoke(CHANNELS.workspacePlace) as Promise<WorkingPlace>,
    setRemote: (project, path) => ipcRenderer.invoke(CHANNELS.workspaceSetRemote, project, path) as Promise<WorkingPlace>,
    use: (mode) => ipcRenderer.invoke(CHANNELS.workspaceUse, mode) as Promise<WorkingPlace>,
  },
  conversations: {
    list: () => ipcRenderer.invoke(CHANNELS.conversationsList) as Promise<Conversation[]>,
    create: (title) => ipcRenderer.invoke(CHANNELS.conversationsCreate, title) as Promise<Conversation>,
    messages: (id) => ipcRenderer.invoke(CHANNELS.conversationsMessages, id) as Promise<ChatMessage[]>,
    send: (id, message, voice) => ipcRenderer.invoke(CHANNELS.conversationsSend, id, message, voice === true) as Promise<Conversation>,
    resume: (id) => ipcRenderer.invoke(CHANNELS.conversationsResume, id) as Promise<Conversation>,
    remove: (id) => ipcRenderer.invoke(CHANNELS.conversationsRemove, id) as Promise<void>,
    onUpdate: (listener) => listen<Conversation>(CHANNELS.conversationsUpdate, listener),
    onText: (listener) => listen<TextEvent>(CHANNELS.conversationsText, listener),
    onActivity: (listener) => listen<ActivityEvent>(CHANNELS.conversationsActivity, listener),
  },
  approvals: {
    onRequest: (listener) => listen<ApprovalPrompt>(CHANNELS.approvalsRequest, listener),
    respond: (id: string, decision: ApprovalDecision) =>
      ipcRenderer.invoke(CHANNELS.approvalsRespond, id, decision) as Promise<void>,
    onSettled: (listener) => listen<string[]>(CHANNELS.approvalsSettled, listener),
    auto: () => ipcRenderer.invoke(CHANNELS.approvalsAuto) as Promise<boolean>,
    setAuto: (on) => ipcRenderer.invoke(CHANNELS.approvalsSetAuto, on === true) as Promise<boolean>,
    onAutoChanged: (listener) => listen<boolean>(CHANNELS.approvalsAutoChanged, listener),
  },
  tools: {
    check: () => ipcRenderer.invoke(CHANNELS.toolsCheck) as Promise<ToolCheck>,
  },
  links: {
    open: (url) => ipcRenderer.invoke(CHANNELS.linksOpen, url) as Promise<void>,
  },
  viewer: {
    project: (projectName, path) => ipcRenderer.invoke(CHANNELS.viewerProject, projectName, path) as Promise<ViewedFile>,
    local: (path) => ipcRenderer.invoke(CHANNELS.viewerLocal, path) as Promise<ViewedFile>,
    save: (name, data) => ipcRenderer.invoke(CHANNELS.viewerSave, name, data) as Promise<string | null>,
    openExternal: (name, data) => ipcRenderer.invoke(CHANNELS.viewerOpenExternal, name, data) as Promise<void>,
    onShow: (listener) => listen<ViewTarget>(CHANNELS.viewerShow, listener),
  },
  voice: {
    transcribe: (wav) => ipcRenderer.invoke(CHANNELS.voiceTranscribe, wav) as Promise<string>,
    speak: (text) => ipcRenderer.invoke(CHANNELS.voiceSpeak, text) as Promise<Uint8Array>,
  },
  dock: {
    tasks: () => ipcRenderer.invoke(CHANNELS.dockTasks),
    onTasks: (listener) => listen(CHANNELS.dockTasksChanged, listener),
    dismiss: (taskId) => ipcRenderer.invoke(CHANNELS.dockDismiss, taskId) as Promise<void>,
    interactive: (on) => ipcRenderer.send(CHANNELS.dockInteractive, on === true),
    openProject: (name, path) => ipcRenderer.send(CHANNELS.dockOpenProject, { name, path }),
    openConversation: (conversationId) => ipcRenderer.send(CHANNELS.dockOpenConversation, conversationId),
    review: () => ipcRenderer.send(CHANNELS.dockReview),
    show: (target) => ipcRenderer.send(CHANNELS.viewerShow, target),
    approve: (taskId, decisions) => ipcRenderer.invoke(CHANNELS.dockApprove, taskId, decisions) as Promise<void>,
    thumbnail: (project, path) =>
      ipcRenderer.invoke(CHANNELS.dockThumbnail, project, path) as Promise<{ data: Uint8Array; contentType: string } | null>,
    onOpenProject: (listener) => listen(CHANNELS.dockOpenProject, listener),
    onOpenConversation: (listener) => listen(CHANNELS.dockOpenConversation, listener),
  },
  tasks: {
    list: () => ipcRenderer.invoke(CHANNELS.tasksList),
    onChanged: (listener) => listen(CHANNELS.tasksChanged, listener),
  },
  files: {
    list: (folder) => ipcRenderer.invoke(CHANNELS.filesList, folder),
    createFolder: (parent, name) => ipcRenderer.invoke(CHANNELS.filesCreateFolder, parent, name),
    rename: (path, name) => ipcRenderer.invoke(CHANNELS.filesRename, path, name),
    move: (path, folder) => ipcRenderer.invoke(CHANNELS.filesMove, path, folder),
    remove: (path) => ipcRenderer.invoke(CHANNELS.filesRemove, path),
    reveal: (path) => ipcRenderer.invoke(CHANNELS.filesReveal, path),
  },
  projects: {
    list: () => ipcRenderer.invoke(CHANNELS.projectsList),
    create: (name) => ipcRenderer.invoke(CHANNELS.projectsCreate, name),
    tree: (projectId) => ipcRenderer.invoke(CHANNELS.projectsTree, projectId),
    upload: (localPath, project, destination) => ipcRenderer.invoke(CHANNELS.projectsUpload, localPath, project, destination),
    download: (project, path, localFolder) => ipcRenderer.invoke(CHANNELS.projectsDownload, project, path, localFolder),
    removeEntry: (projectId, kind, id) => ipcRenderer.invoke(CHANNELS.projectsRemoveEntry, projectId, kind, id),
  },
};

contextBridge.exposeInMainWorld("desktop", desktop);
