import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { AuthService } from "../core/auth";
import { CHANNELS, type ToolCheck, type ViewedFile } from "../core/bridge";
import type { ServerApiPort } from "../core/api";
import type { TurnService } from "../core/conversations/turnService";
import type { TaskMonitor } from "../core/tasks/taskMonitor";
import { mustAsk, type AutoApprovals } from "../core/tools/autoApprovals";
import type { ToolRunner } from "../core/tools/runner";
import { contentTypeFor, downloadFromProject, findProjectFile, uploadToProject } from "../core/tools/transfer";
import { LocalFilesError, type LocalFiles } from "../core/workspace/localFiles";
import { operatorMessage } from "../core/workspace/messages";
import type { NodeFileSystem } from "./nodeFileSystem";
import type { ProjectsApi } from "./projectsApi";
import type { VoiceApi } from "./voiceApi";
import type { WindowApprovals } from "./windowApprovals";
import type { WorkspaceStore } from "./workspaceStore";

export interface AppServices {
  auth: AuthService;
  turns: TurnService;
  tasks: TaskMonitor;
  runner: ToolRunner;
  approvals: WindowApprovals;
  /** Auto mode, in front of the window's questions. */
  auto: AutoApprovals;
  workspace: WorkspaceStore;
  api: ServerApiPort;
  /** The open folder, fenced; shared with the agent's file tools. */
  fileSystem: NodeFileSystem;
  localFiles: LocalFiles;
  projects: ProjectsApi;
  voice: VoiceApi;
  /** The task strip; emptied on sign-out. */
  dock: { reset(): void };
  deviceName: string;
}

// The server's own limits: two minutes of 16 kHz wav, and one reply's worth of text.
const MAX_RECORDING_BYTES = 5 * 1024 * 1024;
const MAX_SPEAK_CHARS = 4000;

// What the viewer brings into the window in one go; the server's own cap.
const MAX_VIEW_BYTES = 200 * 1024 * 1024;

// Handed to the system to open: documents and pictures only. The agent's files can carry
// whatever it read on the web, and a script or program opened this way would run.
const OPENABLE = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "html", "htm", "txt", "md", "csv", "json",
  "docx", "xlsx", "pptx", "doc", "xls", "ppt", "odt", "ods", "odp", "rtf", "mp3", "mp4", "wav", "zip",
]);

/** A file name safe to create on this computer: the last path part, without what Windows refuses. */
function safeName(value: unknown): string {
  const name = String(value ?? "").split(/[\\/]/).pop()!.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return name && name !== "." && name !== ".." ? name.slice(0, 200) : "archivo";
}

function requireBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_VIEW_BYTES) throw new Error("Invalid file");
  return value;
}

function requireText(value: unknown, what: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${what}`);
  return value;
}

/** A path relative to the open folder; "" (the folder itself) is allowed. The file system fences it. */
function requirePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid path");
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireId(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${what}`);
  return value;
}

/** Files-panel failures reach the window as the operator's message, not a stack of internals. */
function forOperator<A extends unknown[], T>(run: (...args: A) => Promise<T>) {
  return async (...args: A): Promise<T> => {
    try {
      return await run(...args);
    } catch (error) {
      throw new Error(operatorMessage(error));
    }
  };
}

/** The window's handlers. Every one refuses a caller that is not the app's own window. */
export function registerAppHandlers(services: AppServices, mainWindow: () => BrowserWindow | null) {
  function handle(channel: string, handler: (...args: unknown[]) => unknown) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const window = mainWindow();
      if (!window || event.sender !== window.webContents) throw new Error("Unknown window");
      return handler(...args);
    });
  }

  handle(CHANNELS.authState, () => services.auth.restore());
  handle(CHANNELS.authLogin, (email, password) =>
    services.auth.login(requireText(email, "email"), requireText(password, "password"), services.deviceName),
  );
  handle(CHANNELS.authLogout, () => {
    services.tasks.stop();
    services.dock.reset();
    services.auto.set(false);
    return services.auth.logout();
  });

  handle(CHANNELS.tasksList, () => services.tasks.refresh());

  handle(CHANNELS.workspaceCurrent, () => services.workspace.current());
  handle(CHANNELS.workspacePlace, () => services.workspace.place());
  handle(CHANNELS.workspaceSetRemote, async (project, path) => {
    await services.workspace.setRemote(requireText(project, "project"), requirePath(path));
    return services.workspace.place();
  });
  handle(CHANNELS.workspaceUse, async (mode) => {
    await services.workspace.use(mode === "remote" ? "remote" : "local");
    return services.workspace.place();
  });
  handle(CHANNELS.workspaceChoose, async () => {
    const window = mainWindow();
    const options = { title: "Carpeta de trabajo", properties: ["openDirectory" as const, "createDirectory" as const] };
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return services.workspace.current();
    await services.workspace.set(picked.filePaths[0]);
    return picked.filePaths[0];
  });

  handle(CHANNELS.conversationsList, () => services.turns.list());
  handle(CHANNELS.conversationsCreate, (title) => services.turns.create(typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : "Nueva conversación"));
  handle(CHANNELS.conversationsMessages, (id) => services.turns.messages(requireText(id, "conversation")));
  handle(CHANNELS.conversationsSend, (id, message, voice) =>
    services.turns.send(requireText(id, "conversation"), requireText(message, "message"), voice === true),
  );
  handle(CHANNELS.conversationsResume, (id) => services.turns.drive(requireText(id, "conversation")));
  handle(CHANNELS.conversationsRemove, async (id) => {
    await services.turns.remove(requireText(id, "conversation"));
  });

  handle(CHANNELS.approvalsAuto, () => services.auto.enabled);
  handle(CHANNELS.approvalsSetAuto, (on) => {
    const enabled = services.auto.set(on === true);
    // what is already on screen goes through too -- all but what must always ask
    if (enabled) services.approvals.approveWaiting((call) => !mustAsk(call));
    return enabled;
  });

  handle(CHANNELS.approvalsRespond, (id, decision) => {
    if (typeof decision !== "object" || decision === null) throw new Error("Invalid decision");
    const { approved, feedback, args } = decision as { approved?: unknown; feedback?: unknown; args?: unknown };
    services.approvals.respond(requireText(id, "approval"), {
      approved: approved === true,
      feedback: typeof feedback === "string" ? feedback : undefined,
      // checked again in respond(), and by the server against the tool's own choices
      args: typeof args === "object" && args !== null ? (args as Record<string, string>) : undefined,
    });
  });

  const files = services.localFiles;
  handle(CHANNELS.filesList, forOperator((folder) => files.list(requirePath(folder))));
  handle(CHANNELS.filesCreateFolder, forOperator((parent, name) => files.createFolder(requirePath(parent), requireText(name, "name"))));
  handle(CHANNELS.filesRename, forOperator((path, name) => files.rename(requirePath(path), requireText(name, "name"))));
  handle(CHANNELS.filesMove, forOperator((path, folder) => files.move(requirePath(path), requirePath(folder))));
  handle(CHANNELS.filesRemove, forOperator((path) => files.remove(requirePath(path))));
  handle(CHANNELS.filesReveal, forOperator(async (path) => {
    shell.showItemInFolder(await services.fileSystem.locate(requirePath(path)));
  }));

  const projects = services.projects;
  handle(CHANNELS.projectsList, forOperator(() => projects.projects()));
  handle(CHANNELS.projectsCreate, forOperator((name) => projects.createProject(requireText(name, "name").trim())));
  handle(CHANNELS.projectsTree, forOperator((id) => projects.tree(requireId(id, "project"))));
  handle(CHANNELS.projectsUpload, forOperator((localPath, project, destination) =>
    uploadToProject(services.fileSystem, projects, {
      localPath: requirePath(localPath),
      project: requireText(project, "project"),
      destination: requirePath(destination),
    }),
  ));
  handle(CHANNELS.projectsDownload, forOperator((project, path, localFolder) =>
    downloadFromProject(services.fileSystem, projects, {
      project: requireText(project, "project"),
      path: requirePath(path),
      localPath: requirePath(localFolder),
    }),
  ));
  handle(CHANNELS.projectsRemoveEntry, forOperator((projectId, kind, id) => {
    if (kind !== "file" && kind !== "folder") throw new Error("Invalid kind");
    return projects.removeEntry(requireId(projectId, "project"), kind, requireId(id, "entry"));
  }));

  handle(CHANNELS.linksOpen, async (url) => {
    // checked here too: the window's word is not trusted for what the system opens
    const target = new URL(requireText(url, "link"));
    if (!["http:", "https:", "mailto:"].includes(target.protocol)) throw new Error("Only web and mail links open");
    await shell.openExternal(target.toString());
  });

  handle(CHANNELS.viewerProject, forOperator(async (projectName, path): Promise<ViewedFile> => {
    const { project, file } = await findProjectFile(projects, requireText(projectName, "project"), requirePath(path));
    if (file.sizeBytes > MAX_VIEW_BYTES) throw new LocalFilesError(`'${file.name}' es demasiado grande para abrirlo aquí. Descárgalo desde el panel de archivos.`);
    const { data, contentType } = await projects.content(project.id, file.id);
    return { name: file.name, project: project.name, path: String(path), contentType, data };
  }));
  handle(CHANNELS.viewerLocal, forOperator(async (path): Promise<ViewedFile> => {
    const where = requirePath(path);
    const info = await services.fileSystem.stat(where);
    if (!info.exists || info.isDirectory) throw new LocalFilesError("Ese archivo ya no existe.");
    if (info.size > MAX_VIEW_BYTES) throw new LocalFilesError("Ese archivo es demasiado grande para abrirlo aquí.");
    const name = where.split("/").pop() ?? where;
    return { name, path: where, contentType: contentTypeFor(name), data: await services.fileSystem.readBytes(where) };
  }));
  handle(CHANNELS.viewerSave, async (name, data) => {
    const bytes = requireBytes(data);
    const window = mainWindow();
    const options = { title: "Guardar archivo", defaultPath: join(app.getPath("downloads"), safeName(name)) };
    const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return null;
    await writeFile(picked.filePath, bytes);
    return picked.filePath;
  });
  handle(CHANNELS.viewerOpenExternal, async (name, data) => {
    const bytes = requireBytes(data);
    const file = safeName(name);
    const suffix = file.includes(".") ? file.split(".").pop()!.toLowerCase() : "";
    if (!OPENABLE.has(suffix)) throw new Error("Este tipo de archivo no se abre desde aquí; descárgalo primero.");
    const folder = join(app.getPath("temp"), "the-way", randomUUID());
    await mkdir(folder, { recursive: true });
    const target = join(folder, file);
    await writeFile(target, bytes);
    const failed = await shell.openPath(target);
    if (failed) throw new Error(failed);
  });

  handle(CHANNELS.voiceTranscribe, (wav) => {
    if (!(wav instanceof Uint8Array) || wav.byteLength > MAX_RECORDING_BYTES) throw new Error("Invalid recording");
    return services.voice.transcribe(wav);
  });
  handle(CHANNELS.voiceSpeak, (text) => services.voice.speak(requireText(text, "text").slice(0, MAX_SPEAK_CHARS)));

  handle(CHANNELS.toolsCheck, async (): Promise<ToolCheck> => {
    const offered = await services.api.request<{ name: string }[]>("GET", "/desktop-tools");
    return { missing: services.runner.missingFrom(offered.map((tool) => tool.name)) };
  });
}
