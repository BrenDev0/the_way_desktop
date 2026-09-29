import { BrowserWindow, session, type WebContents } from "electron";
import type { BrowserPort, TabInfo } from "../core/tools/ports";

// Its own profile, kept between runs, so WhatsApp Web and anything else the user signs
// into stay signed in -- and separate from the app's window, which never loads the web.
const PARTITION = "persist:assistant-browser";
const BLANK = new Set(["", "about:blank"]);
const LOAD_TIMEOUT = 30_000;

/**
 * The assistant's browser: real, visible windows the user can watch and step into (to
 * scan WhatsApp's QR code, say). One window per tab. Pages are driven with scripts and
 * native input events, so a click lands the way a person's does.
 */
export class ElectronBrowser implements BrowserPort {
  private readonly windows: BrowserWindow[] = [];
  private current: BrowserWindow | null = null;

  async open(url: string): Promise<void> {
    const target = this.current && !this.current.isDestroyed() && BLANK.has(this.current.webContents.getURL())
      ? this.current
      : this.newWindow();
    this.current = target;
    target.show();
    await withTimeout(target.loadURL(url), LOAD_TIMEOUT).catch(() => {
      // a page that never fires its final load event is still usable -- WhatsApp is one
    });
  }

  async text(): Promise<string> {
    return this.evaluate<string>("document.body ? document.body.innerText : ''");
  }

  async evaluate<T>(script: string): Promise<T> {
    return (await this.contents().executeJavaScript(script, true)) as T;
  }

  async type(text: string, pressEnter: boolean): Promise<void> {
    const contents = this.contents();
    if (text) await contents.insertText(text);
    if (pressEnter) {
      contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
      contents.sendInputEvent({ type: "char", keyCode: "\r" });
      contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
    }
  }

  async clickAt(x: number, y: number): Promise<void> {
    const contents = this.contents();
    contents.sendInputEvent({ type: "mouseMove", x, y });
    contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }

  async tabs(): Promise<TabInfo[]> {
    return this.live().map((window) => ({ title: window.webContents.getTitle(), url: window.webContents.getURL() }));
  }

  async switchTo(match: string): Promise<boolean> {
    const wanted = match.toLowerCase();
    const found = this.live().find(
      (window) =>
        window.webContents.getTitle().toLowerCase().includes(wanted) ||
        window.webContents.getURL().toLowerCase().includes(wanted),
    );
    if (!found) return false;
    this.current = found;
    found.show();
    return true;
  }

  async close(): Promise<void> {
    for (const window of this.live()) window.close();
    this.windows.length = 0;
    this.current = null;
  }

  wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private contents(): WebContents {
    if (!this.current || this.current.isDestroyed()) {
      const live = this.live();
      this.current = live[live.length - 1] ?? null;
    }
    if (!this.current) throw new Error("No browser is open. Call OpenBrowserPage first.");
    return this.current.webContents;
  }

  private live(): BrowserWindow[] {
    const alive = this.windows.filter((window) => !window.isDestroyed());
    this.windows.splice(0, this.windows.length, ...alive);
    return alive;
  }

  private newWindow(): BrowserWindow {
    const profile = session.fromPartition(PARTITION);
    // Some sites, WhatsApp Web among them, turn away browsers they do not recognise;
    // this presents as the Chrome that Electron is built on.
    profile.setUserAgent(chromeUserAgent());

    const window = new BrowserWindow({
      width: 1200,
      height: 820,
      title: "THE WAY · Navegador",
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // links that would open a popup load in the same window instead
    window.webContents.setWindowOpenHandler(({ url }) => {
      void window.loadURL(url);
      return { action: "deny" };
    });
    this.windows.push(window);
    return window;
  }
}

function chromeUserAgent(): string {
  const platform =
    process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "Windows NT 10.0; Win64; x64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), milliseconds)),
  ]);
}
