import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { ConnectionService } from "../core/connectionService";
import { ServerConnectionAdapter } from "./serverConnectionAdapter";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

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
    backgroundColor: "#050705",
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

app.whenReady().then(() => {
  const service = new ConnectionService(new ServerConnectionAdapter(app.getPath("userData")));
  registerConnectionHandlers(service);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
