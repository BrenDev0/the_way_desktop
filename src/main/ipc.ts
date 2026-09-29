import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { AuthService } from "../core/auth";
import { CHANNELS, type ToolCheck } from "../core/bridge";
import type { ServerApiPort } from "../core/api";
import type { TurnService } from "../core/conversations/turnService";
import type { ToolRunner } from "../core/tools/runner";
import { downloadFromProject, uploadToProject } from "../core/tools/transfer";
import type { LocalFiles } from "../core/workspace/localFiles";
import { operatorMessage } from "../core/workspace/messages";
import type { NodeFileSystem } from "./nodeFileSystem";
import type { ProjectsApi } from "./projectsApi";
import type { WindowApprovals } from "./windowApprovals";
import type { WorkspaceStore } from "./workspaceStore";

export interface AppServices {
  auth: AuthService;
  turns: TurnService;
  runner: ToolRunner;
  approvals: WindowApprovals;
  workspace: WorkspaceStore;
  api: ServerApiPort;
  /** The open folder, fenced; shared with the agent's file tools. */
  fileSystem: NodeFileSystem;
  localFiles: LocalFiles;
  projects: ProjectsApi;
  deviceName: string;
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
  handle(CHANNELS.authLogout, () => services.auth.logout());

  handle(CHANNELS.workspaceCurrent, () => services.workspace.current());
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
  handle(CHANNELS.conversationsSend, (id, message) =>
    services.turns.send(requireText(id, "conversation"), requireText(message, "message")),
  );
  handle(CHANNELS.conversationsResume, (id) => services.turns.drive(requireText(id, "conversation")));
  handle(CHANNELS.conversationsRemove, async (id) => {
    await services.turns.remove(requireText(id, "conversation"));
  });

  handle(CHANNELS.approvalsRespond, (id, decision) => {
    if (typeof decision !== "object" || decision === null) throw new Error("Invalid decision");
    const { approved, feedback } = decision as { approved?: unknown; feedback?: unknown };
    services.approvals.respond(requireText(id, "approval"), {
      approved: approved === true,
      feedback: typeof feedback === "string" ? feedback : undefined,
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

  handle(CHANNELS.toolsCheck, async (): Promise<ToolCheck> => {
    const offered = await services.api.request<{ name: string }[]>("GET", "/desktop-tools");
    return { missing: services.runner.missingFrom(offered.map((tool) => tool.name)) };
  });
}
