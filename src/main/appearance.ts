import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, ipcMain, nativeTheme } from "electron";
import { CHANNELS, type Appearance, type ThemeChoice } from "../core/bridge";

const CHOICES: readonly ThemeChoice[] = ["dark", "light", "system"];

/** The window background before the page paints, so opening never flashes the other theme. */
export const BACKGROUND = { dark: "#060a0e", light: "#eef2ef" } as const;

function current(): Appearance {
  const theme = nativeTheme.themeSource as ThemeChoice;
  return { theme, resolved: nativeTheme.shouldUseDarkColors ? "dark" : "light" };
}

/**
 * Light, dark, or as Windows is set -- remembered between runs. Electron's own theme is the
 * one source: the title bar, dialogs and menus follow it, and the pages are told it, so
 * they all change together. Dark until the user picks otherwise: it is the brand.
 */
export async function setUpAppearance(userDataDirectory: string, mainWindow: () => BrowserWindow | null) {
  const path = join(userDataDirectory, "appearance.json");
  let saved: unknown;
  try {
    saved = (JSON.parse(await readFile(path, "utf8")) as { theme?: unknown }).theme;
  } catch {
    saved = undefined;
  }
  nativeTheme.themeSource = CHOICES.includes(saved as ThemeChoice) ? (saved as ThemeChoice) : "dark";

  // also fires when Windows switches between light and dark under "system"
  nativeTheme.on("updated", () => {
    const appearance = current();
    // the app's only: the task strip is see-through, and a background would fill it in
    mainWindow()?.setBackgroundColor(BACKGROUND[appearance.resolved]);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CHANNELS.appearanceChanged, appearance);
    }
  });

  // every page asks, the task strip too: it is only which theme is on
  ipcMain.handle(CHANNELS.appearanceGet, () => current());
  ipcMain.handle(CHANNELS.appearanceSet, async (event, theme: unknown) => {
    if (event.sender !== mainWindow()?.webContents) throw new Error("Unknown window");
    if (!CHOICES.includes(theme as ThemeChoice)) throw new Error("Invalid theme");
    nativeTheme.themeSource = theme as ThemeChoice;
    await writeFile(path, JSON.stringify({ theme }), "utf8");
    return current();
  });
}
