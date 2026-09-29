import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AuthState } from "../core/auth";
import type { ChatMessage, Conversation } from "../core/api";
import { CHANNELS, type ActivityEvent, type ApprovalPrompt, type DesktopBridge, type ToolCheck, type Unsubscribe, type TextEvent } from "../core/bridge";
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
  auth: {
    state: () => ipcRenderer.invoke(CHANNELS.authState) as Promise<AuthState>,
    login: (email, password) => ipcRenderer.invoke(CHANNELS.authLogin, email, password) as Promise<AuthState>,
    logout: () => ipcRenderer.invoke(CHANNELS.authLogout) as Promise<AuthState>,
    onSignedOut: (listener) => listen(CHANNELS.authSignedOut, () => listener()),
  },
  workspace: {
    current: () => ipcRenderer.invoke(CHANNELS.workspaceCurrent) as Promise<string | null>,
    choose: () => ipcRenderer.invoke(CHANNELS.workspaceChoose) as Promise<string | null>,
  },
  conversations: {
    list: () => ipcRenderer.invoke(CHANNELS.conversationsList) as Promise<Conversation[]>,
    create: (title) => ipcRenderer.invoke(CHANNELS.conversationsCreate, title) as Promise<Conversation>,
    messages: (id) => ipcRenderer.invoke(CHANNELS.conversationsMessages, id) as Promise<ChatMessage[]>,
    send: (id, message) => ipcRenderer.invoke(CHANNELS.conversationsSend, id, message) as Promise<Conversation>,
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
  },
  tools: {
    check: () => ipcRenderer.invoke(CHANNELS.toolsCheck) as Promise<ToolCheck>,
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
