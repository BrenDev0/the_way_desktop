import { app, BrowserWindow, ipcMain, Menu, nativeTheme, Notification } from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { AuthService } from "../core/auth";
import { CHANNELS } from "../core/bridge";
import { ConnectionService } from "../core/connectionService";
import type { Conversation } from "../core/api";
import { pauseText } from "../core/conversations/pause";
import { TurnService } from "../core/conversations/turnService";
import { TaskMonitor, type TaskView } from "../core/tasks/taskMonitor";
import { desktopTools } from "../core/tools";
import { AutoApprovals } from "../core/tools/autoApprovals";
import { ImageAllowance } from "../core/tools/imageAllowance";
import { PresetAnswers } from "../core/tools/presetAnswers";
import { findProjectFile } from "../core/tools/transfer";
import { ToolRunner } from "../core/tools/runner";
import { LocalFiles } from "../core/workspace/localFiles";
import { ApiClient } from "./apiClient";
import { BACKGROUND, setUpAppearance } from "./appearance";
import { ConversationEvents } from "./conversationEvents";
import { DockWindow } from "./dockWindow";
import { ElectronBrowser } from "./electronBrowser";
import { registerAppHandlers, type AppServices } from "./ipc";
import { NodeFileSystem } from "./nodeFileSystem";
import { ProjectsApi } from "./projectsApi";
import { ServerConnectionAdapter } from "./serverConnectionAdapter";
import { handleSquirrelEvent } from "./squirrel";
import { TokenStore } from "./tokenStore";
import { VoiceApi } from "./voiceApi";
import { WindowApprovals } from "./windowApprovals";
import { WorkspaceStore } from "./workspaceStore";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
/** Set at build time from THE_WAY_SERVER_URL (see vite.main.config.mjs); empty in dev builds without it. */
declare const THE_WAY_SERVER_URL: string;

let mainWindow: BrowserWindow | null = null;

/** The renderer page, at `hash` -- "" for the app, "dock" for the task strip. */
function loadPage(window: BrowserWindow, hash: string) {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(hash ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${hash}` : MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), hash ? { hash } : undefined);
  }
}

const dock = new DockWindow(() => mainWindow, loadPage);

function registerConnectionHandlers(service: ConnectionService) {
  function fromMainWindow(sender: Electron.WebContents) {
    if (!mainWindow || sender !== mainWindow.webContents) throw new Error("Unknown window");
  }

  ipcMain.handle("connection:load", (event) => {
    fromMainWindow(event.sender);
    return service.load();
  });
  ipcMain.handle("connection:connect", (event, baseUrl: unknown) => {
    fromMainWindow(event.sender);
    if (typeof baseUrl !== "string") throw new Error("Invalid server URL");
    return service.connect(baseUrl);
  });
  ipcMain.handle("connection:check", (event, baseUrl: unknown) => {
    fromMainWindow(event.sender);
    if (typeof baseUrl !== "string") throw new Error("Invalid server URL");
    return service.check(baseUrl);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: BACKGROUND[nativeTheme.shouldUseDarkColors ? "dark" : "light"],
    title: "THE WAY / OPERADOR",
    // Windows draws the File/Edit/View bar light whatever the theme: hidden, it shows on
    // Alt, and its shortcuts (reload, zoom, devtools) work all the same
    autoHideMenuBar: true,
    // packaged, the executable carries the icon; run from source it is electron.exe's
    ...(app.isPackaged ? {} : { icon: join(app.getAppPath(), "assets", "icon.png") }),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  loadPage(mainWindow, "");
  // the strip follows the app to whichever screen it is on
  mainWindow.on("moved", () => dock.place());
  mainWindow.on("closed", () => {
    mainWindow = null;
    // the strip is a window too: left open, it would keep the app from quitting
    dock.close();
  });
}

/** A task that ends while the operator is looking elsewhere gets a system notification. */
function notifyFinished(task: TaskView) {
  if (mainWindow?.isFocused() || !Notification.isSupported()) return;
  const where = task.deliverProject ? ` · ${task.deliverProject}${task.deliverPath ? `/${task.deliverPath}` : ""}` : "";
  const notice = new Notification({
    title: task.status === "done" ? "Tarea lista" : "La tarea falló",
    body: `${task.description}${where}`,
  });
  notice.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  notice.show();
}

/** A task waits on the user. The question is already in the window; this gets them there. */
function notifyNeedsApproval(task: TaskView) {
  if (!mainWindow || mainWindow.isFocused()) return;
  mainWindow.flashFrame(true);
  mainWindow.once("focus", () => mainWindow?.flashFrame(false));
  if (!Notification.isSupported()) return;
  const notice = new Notification({ title: "Una tarea necesita tu aprobación", body: task.description });
  notice.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  notice.show();
}

/** Pauses already told about: a stream reopened on a paused turn says so again. */
const pausesTold = new Set<string>();

/** A turn paused (rate limit, quota, timeout...) while the operator looks elsewhere. The
 *  banner with REANUDAR is already in the window; this gets them there. */
function notifyPaused(conversation: Conversation) {
  if (conversation.status !== "paused") return;
  const key = `${conversation.id}:${conversation.pause?.pausedAt ?? ""}`;
  if (pausesTold.has(key)) return;
  pausesTold.add(key);
  if (!mainWindow || mainWindow.isFocused()) return;
  mainWindow.flashFrame(true);
  mainWindow.once("focus", () => mainWindow?.flashFrame(false));
  if (!Notification.isSupported()) return;
  const { title, body } = pauseText(conversation.pause);
  const notice = new Notification({ title: `${title} · ${conversation.title}`, body });
  notice.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  notice.show();
}

/** The signed-in half of the app: the server API, the conversation loop and the tools. */
function createServices(connection: ServerConnectionAdapter): AppServices {
  const userData = app.getPath("userData");
  const tokens = new TokenStore(userData);
  // the monitor is made below; a revoked token must stop its streams too
  let monitor: TaskMonitor | undefined;
  // made below, after the monitor that tells it a task has ended
  let turnsRef: TurnService | undefined;
  const api = new ApiClient(connection, tokens, () => {
    monitor?.stop();
    dock.reset();
    mainWindow?.webContents.send(CHANNELS.authSignedOut);
  });
  const workspace = new WorkspaceStore(userData);
  const approvals = new WindowApprovals(() => mainWindow);
  // every approval goes through auto mode first; off at every start
  const auto = new AutoApprovals(approvals);
  auto.onChange((on) => mainWindow?.webContents.send(CHANNELS.approvalsAutoChanged, on));
  // a background task's questions can also be answered from the strip on the screen edge
  const taskAnswers = new PresetAnswers(auto);

  // One fenced file system and one projects client, shared by the agent's tools and the files panel.
  const fileSystem = new NodeFileSystem(() => workspace.current());
  const projects = new ProjectsApi(api);

  const runner = new ToolRunner(
    desktopTools({ files: fileSystem, browser: new ElectronBrowser(), projects }),
    // one image approval covers the rest of a reply's images; background tasks keep the
    // same allowance on the server
    new ImageAllowance(auto),
  );
  const send = (channel: string, payload: unknown) => mainWindow?.webContents.send(channel, payload);
  const events = new ConversationEvents(api);
  const tasks = new TaskMonitor(api, events, {
    changed: (list) => {
      send(CHANNELS.tasksChanged, list);
      dock.update(list);
    },
    finished: (task) => {
      notifyFinished(task);
      // The agent reports a finished task on its own, in the conversation that started it:
      // follow that conversation, so the report is written out live. (A turn already being
      // followed is shared, not followed twice; an idle one just ends at once.)
      if (task.conversationId) void turnsRef?.drive(task.conversationId).catch(() => {});
    },
    needsApproval: notifyNeedsApproval,
  }, { approvals: taskAnswers });
  monitor = tasks;
  // reading the list again re-asks any task whose question was closed unanswered
  dock.onReview = () => void tasks.refresh().catch(() => {});
  // Answered from the strip: each call's answer is set aside for its question, and any of
  // those questions already on screen is answered and taken down. If none is being asked
  // right now (closed earlier), reading the list asks again -- and finds the answers waiting.
  dock.onApprove = async (_taskId, decisions) => {
    for (const { callId, approved, args } of decisions) taskAnswers.preset(callId, { approved, args });
    const answered = decisions.some(({ callId, approved, args }) => approvals.answerCall(callId, { approved, args }));
    if (!answered) await tasks.refresh();
  };
  dock.onThumbnail = async (project, path) => {
    const { project: found, file } = await findProjectFile(projects, project, path);
    // a tile is 52px: an image too big to send for that is not worth the wait
    if (file.sizeBytes > 8 * 1024 * 1024) return null;
    return projects.content(found.id, file.id);
  };
  const turns = new TurnService(api, events, runner, {
    update: (conversation) => {
      send(CHANNELS.conversationsUpdate, conversation);
      notifyPaused(conversation);
    },
    text: (conversationId, text) => send(CHANNELS.conversationsText, { conversationId, text }),
    message: (conversationId, message) => send(CHANNELS.conversationsActivity, { conversationId, message }),
    activity: (conversationId, tool) => {
      tasks.activity(tool);
      send(CHANNELS.conversationsActivity, { conversationId, tool });
    },
    // a task outlives the turn that started it: the monitor carries on from this event
    task: (conversationId, task, eventId) => tasks.track(conversationId, task, eventId),
  }, {
    folder: () => workspace.current(),
    remote: async () => {
      const place = await workspace.place();
      return place.mode === "remote" && place.remote
        ? [place.remote.project, place.remote.path].filter(Boolean).join("/")
        : null;
    },
  });
  turnsRef = turns;

  return {
    auth: new AuthService(api, tokens),
    turns,
    tasks,
    runner,
    approvals,
    auto,
    workspace,
    api,
    fileSystem,
    localFiles: new LocalFiles(fileSystem),
    projects,
    voice: new VoiceApi(api),
    dock,
    deviceName: `THE WAY Desktop · ${hostname()}`,
  };
}

/**
 * Electron's default menu, except that Minimize no longer claims Ctrl+M -- that is the
 * chat's hold-to-talk key, and a menu accelerator would minimise the window instead.
 */
function setApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Window",
      submenu: [
        { role: "minimize", registerAccelerator: false },
        ...(process.platform === "darwin" ? [{ role: "zoom" as const }] : []),
        { role: "close" },
      ],
    },
  ]));
}

// The login, server and working folder live here. Electron would name it after the product,
// which was "THE WAY Desktop" before it became "THE WAY": kept, so renaming signs no one out.
app.setPath("userData", join(app.getPath("appData"), "THE WAY Desktop"));

// Run by the installer to make or remove the shortcuts: it does only that, then quits.
const installing = handleSquirrelEvent(() => app.quit());

if (!installing) app.whenReady().then(async () => {
  // before the window: it opens in the chosen theme, title bar, dialogs and menus included
  await setUpAppearance(app.getPath("userData"), () => mainWindow);
  setApplicationMenu();
  dock.register();
  const adapter = new ServerConnectionAdapter(app.getPath("userData"), THE_WAY_SERVER_URL || null);
  const service = new ConnectionService(adapter);
  registerConnectionHandlers(service);
  registerAppHandlers(createServices(adapter), () => mainWindow);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
