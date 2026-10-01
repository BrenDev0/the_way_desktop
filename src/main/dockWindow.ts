import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { CHANNELS } from "../core/bridge";
import { DockTasks } from "../core/tasks/dockTasks";
import type { TaskView } from "../core/tasks/taskMonitor";

/** Wide enough for an open card beside the column of icons. */
const WIDTH = 440;

export interface DockDecision {
  callId: string;
  approved: boolean;
  args?: Record<string, string>;
}

/**
 * The strip down the edge of the screen that background tasks fly out to.
 *
 * A frameless, transparent window that stays above other apps, so a task stays in view
 * while the user works elsewhere -- with the app minimised too. Only the icons and an open
 * card take the mouse: everywhere else the strip is click-through, so the window behind
 * it does not lose the strip's worth of screen. It exists only while there is an icon.
 */
export class DockWindow {
  private window: BrowserWindow | null = null;
  private readonly selection = new DockTasks();
  private all: TaskView[] = [];
  private docked: TaskView[] = [];
  /** Puts any waiting task's question to the user again; set once the services exist. */
  onReview: (() => void) | undefined;
  /** Answers a waiting task from the strip; set once the services exist. */
  onApprove: ((taskId: string, decisions: DockDecision[]) => Promise<void>) | undefined;
  /** An image's bytes for a tile; set once the services exist. */
  onThumbnail: ((project: string, path: string) => Promise<{ data: Uint8Array; contentType: string } | null>) | undefined;

  constructor(
    private readonly mainWindow: () => BrowserWindow | null,
    private readonly load: (window: BrowserWindow, hash: string) => void,
  ) {}

  /** The monitor's list, every time it changes. */
  update(tasks: TaskView[]): void {
    this.all = tasks;
    this.docked = this.selection.select(tasks);
    this.sync();
  }

  /** Signed out: none of it was theirs to see any more. */
  reset(): void {
    this.selection.reset();
    this.all = [];
    this.docked = [];
    this.sync();
  }

  close(): void {
    this.window?.destroy();
    this.window = null;
  }

  /** Same edge, the screen the app is on -- after it moves, or a monitor changes. */
  place(): void {
    if (!this.window) return;
    const main = this.mainWindow();
    const display = main ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay();
    const area = display.workArea;
    this.window.setBounds({ x: area.x + area.width - WIDTH, y: area.y, width: WIDTH, height: area.height });
  }

  register(): void {
    const fromDock = (event: IpcMainInvokeEvent | IpcMainEvent) => {
      if (!this.window || event.sender !== this.window.webContents) throw new Error("Unknown window");
    };
    // Main-window asks come from the dock, so they are refused from anywhere else.
    ipcMain.handle(CHANNELS.dockTasks, (event) => {
      fromDock(event);
      return this.docked;
    });
    ipcMain.handle(CHANNELS.dockDismiss, (event, taskId: unknown) => {
      fromDock(event);
      if (typeof taskId === "string" && this.selection.dismiss(taskId, this.all)) this.update(this.all);
    });
    ipcMain.on(CHANNELS.dockInteractive, (event, on: unknown) => {
      try { fromDock(event); } catch { return; }
      // forward: the page still sees the pointer move, which is how it knows to take it back
      this.window?.setIgnoreMouseEvents(on !== true, { forward: true });
    });
    ipcMain.on(CHANNELS.dockOpenProject, (event, target: unknown) => {
      try { fromDock(event); } catch { return; }
      const { name, path } = (target ?? {}) as { name?: unknown; path?: unknown };
      if (typeof name !== "string") return;
      this.forward(CHANNELS.dockOpenProject, { name, path: typeof path === "string" ? path : null });
    });
    ipcMain.on(CHANNELS.dockOpenConversation, (event, conversationId: unknown) => {
      try { fromDock(event); } catch { return; }
      if (typeof conversationId === "string") this.forward(CHANNELS.dockOpenConversation, conversationId);
    });
    ipcMain.on(CHANNELS.viewerShow, (event, target: unknown) => {
      try { fromDock(event); } catch { return; }
      const { project, path, kind } = (target ?? {}) as { project?: unknown; path?: unknown; kind?: unknown };
      if (typeof project !== "string" || typeof path !== "string") return;
      this.forward(CHANNELS.viewerShow, { project, path, kind: kind === "folder" ? "folder" : "file" });
    });
    ipcMain.handle(CHANNELS.dockApprove, async (event, taskId: unknown, decisions: unknown) => {
      fromDock(event);
      if (typeof taskId !== "string" || !Array.isArray(decisions)) throw new Error("Invalid approval");
      const clean: DockDecision[] = decisions.flatMap((item) => {
        const { callId, approved, args } = (item ?? {}) as { callId?: unknown; approved?: unknown; args?: unknown };
        if (typeof callId !== "string") return [];
        const picks = typeof args === "object" && args !== null
          ? Object.fromEntries(Object.entries(args).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
          : undefined;
        return [{ callId, approved: approved === true, args: picks }];
      });
      await this.onApprove?.(taskId, clean);
    });
    ipcMain.handle(CHANNELS.dockThumbnail, async (event, project: unknown, path: unknown) => {
      fromDock(event);
      if (typeof project !== "string" || typeof path !== "string") return null;
      return (await this.onThumbnail?.(project, path).catch(() => null)) ?? null;
    });
    ipcMain.on(CHANNELS.dockReview, (event) => {
      try { fromDock(event); } catch { return; }
      this.forward(null, null);
      this.onReview?.();
    });
    screen.on("display-metrics-changed", () => this.place());
    screen.on("display-removed", () => this.place());
  }

  /** The app comes forward, then is told what to open (if anything). */
  private forward(channel: string | null, payload: unknown): void {
    const main = this.mainWindow();
    if (!main) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
    if (channel) main.webContents.send(channel, payload);
  }

  private sync(): void {
    if (!this.docked.length) {
      this.window?.hide();
      return;
    }
    const window = this.window ?? this.create();
    window.webContents.send(CHANNELS.dockTasksChanged, this.docked);
    if (!window.isVisible()) {
      this.place();
      // never steals focus from what the user is typing into
      window.showInactive();
    }
  }

  private create(): BrowserWindow {
    const window = new BrowserWindow({
      width: WIDTH,
      height: 600,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "THE WAY / TAREAS",
      webPreferences: {
        preload: join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // above ordinary always-on-top windows, below the system's own popups
    window.setAlwaysOnTop(true, "floating");
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("closed", () => {
      if (this.window === window) this.window = null;
    });
    this.load(window, "dock");
    this.window = window;
    return window;
  }
}
