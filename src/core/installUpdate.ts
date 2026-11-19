/**
 * The app updating itself: download the installer the server publishes, start it, and leave so
 * it can replace the app (on Windows Squirrel installs the new version and opens it again; on a Mac
 * the app swaps itself for the new one and reopens). The pieces that touch the computer are ports,
 * so the order and the checks can be tested.
 *
 * Nothing here is trusted blindly: the link must be https (or loopback, for a local server), the
 * file is saved under a name this app chose, and an installer that arrived short is thrown away
 * rather than run.
 */

import { platformOf } from "./update";
import { FriendlyError } from "./userMessages";

export interface InstallerLink {
  url: string;
  filename: string;
  version: string | null;
}

export interface Downloaded {
  file: string;
  written: number;
  /** What the server said it would send; null when it did not say. */
  expected: number | null;
}

export interface UpdaterPorts {
  /** The link the server gives for this computer's installer. */
  link(platform: "windows" | "mac"): Promise<InstallerLink>;
  download(url: string, filename: string): Promise<Downloaded>;
  discard(file: string): Promise<void>;
  /** Starts the installer (on a Mac, the replacement) on its own, so it carries on when this app has quit. */
  launch(file: string): Promise<void>;
  quit(): void;
}

/** A real installer is far bigger than this; anything smaller is an error page or a cut-off. */
export const MIN_INSTALLER_BYTES = 1_000_000;

const SAFE_NAMES = {
  windows: { pattern: /^THE-WAY-Setup(?:-\d+\.\d+\.\d+)?\.exe$/, fallback: "THE-WAY-Setup.exe" },
  mac: { pattern: /^THE-WAY-mac(?:-\d+\.\d+\.\d+)?\.zip$/, fallback: "THE-WAY-mac.zip" },
};

function trusted(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export async function installUpdate(nodePlatform: string, ports: UpdaterPorts): Promise<void> {
  const platform = platformOf(nodePlatform);
  if (!platform) {
    throw new FriendlyError("La actualización desde la app solo está disponible en Windows y macOS. Descarga la nueva versión desde la página.");
  }

  const link = await ports.link(platform);
  if (!trusted(link.url)) throw new FriendlyError("El enlace de descarga no es seguro, así que no se instaló nada.");

  const names = SAFE_NAMES[platform];
  const saved = await ports.download(link.url, names.pattern.test(link.filename) ? link.filename : names.fallback);
  if (saved.written < MIN_INSTALLER_BYTES || (saved.expected !== null && saved.written !== saved.expected)) {
    await ports.discard(saved.file).catch(() => {});
    throw new FriendlyError("La descarga quedó incompleta. Inténtalo de nuevo.");
  }

  await ports.launch(saved.file);
  ports.quit();
}
