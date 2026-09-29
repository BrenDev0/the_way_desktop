import { app, BrowserWindow, ipcMain } from "electron";
import { hostname } from "node:os";
import { join } from "node:path";
import { AuthService } from "../core/auth";
import { CHANNELS } from "../core/bridge";
import { ConnectionService } from "../core/connectionService";
import { TurnService } from "../core/conversations/turnService";
import { desktopTools } from "../core/tools";
import { ToolRunner } from "../core/tools/runner";
import { LocalFiles } from "../core/workspace/localFiles";
import { ApiClient } from "./apiClient";
import { ConversationEvents } from "./conversationEvents";
import { ElectronBrowser } from "./electronBrowser";
import { registerAppHandlers, type AppServices } from "./ipc";
import { NodeFileSystem } from "./nodeFileSystem";
import { ProjectsApi } from "./projectsApi";
import { ServerConnectionAdapter } from "./serverConnectionAdapter";
import { TokenStore } from "./tokenStore";
import { WindowApprovals } from "./windowApprovals";
import { WorkspaceStore } from "./workspaceStore";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
/** Set at build time from THE_WAY_SERVER_URL (see vite.main.config.mjs); empty in dev builds without it. */
declare const THE_WAY_SERVER_URL: string;

let mainWindow: BrowserWindow | null = null;

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
    backgroundColor: "#060a0e",
    title: "THE WAY / OPERADOR",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  mainWindow.on("closed", () => { mainWindow = null; });
}

/** The signed-in half of the app: the server API, the conversation loop and the tools. */
function createServices(connection: ServerConnectionAdapter): AppServices {
  const userData = app.getPath("userData");
  const tokens = new TokenStore(userData);
  const api = new ApiClient(connection, tokens, () => mainWindow?.webContents.send(CHANNELS.authSignedOut));
  const workspace = new WorkspaceStore(userData);
  const approvals = new WindowApprovals(() => mainWindow);

  // One fenced file system and one projects client, shared by the agent's tools and the files panel.
  const fileSystem = new NodeFileSystem(() => workspace.current());
  const projects = new ProjectsApi(api);

  const runner = new ToolRunner(
    desktopTools({ files: fileSystem, browser: new ElectronBrowser(), projects }),
    approvals,
  );
  const send = (channel: string, payload: unknown) => mainWindow?.webContents.send(channel, payload);
  const turns = new TurnService(api, new ConversationEvents(api), runner, {
    update: (conversation) => send(CHANNELS.conversationsUpdate, conversation),
    text: (conversationId, text) => send(CHANNELS.conversationsText, { conversationId, text }),
    message: (conversationId, message) => send(CHANNELS.conversationsActivity, { conversationId, message }),
    activity: (conversationId, tool) => send(CHANNELS.conversationsActivity, { conversationId, tool }),
  });

  return {
    auth: new AuthService(api, tokens),
    turns,
    runner,
    approvals,
    workspace,
    api,
    fileSystem,
    localFiles: new LocalFiles(fileSystem),
    projects,
    deviceName: `THE WAY Desktop · ${hostname()}`,
  };
}

app.whenReady().then(() => {
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
