import { spawn } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

/**
 * The Windows installer (Squirrel) starts the app with --squirrel-install, --squirrel-updated,
 * --squirrel-uninstall or --squirrel-obsolete, and expects it to do its part and leave:
 * on install and update, put the shortcuts on the desktop and in the Start menu (with the
 * app's icon); on uninstall, take them away. True when this run was one of those -- the
 * app must then not open a window.
 */
export function handleSquirrelEvent(quit: () => void): boolean {
  if (process.platform !== "win32") return false;
  const event = process.argv[1];
  if (!event?.startsWith("--squirrel-")) return false;

  // Update.exe sits one folder up from the versioned app folder: ...\the_way\app-0.1.0\the-way.exe
  const update = resolve(dirname(process.execPath), "..", "Update.exe");
  const exe = basename(process.execPath);

  // The app opened for the user right after installing: a normal start. The shortcuts are
  // made again here, in the background -- the installer gives --squirrel-install only some
  // 15 seconds, and a first launch the antivirus scans can take longer, leaving none.
  // Making them twice is harmless.
  if (event === "--squirrel-firstrun") {
    spawn(update, [`--createShortcut=${exe}`], { detached: true, stdio: "ignore" })
      .on("error", () => {})
      .unref();
    return false;
  }

  const run = (args: string[]) => {
    const child = spawn(update, args, { detached: true });
    child.on("close", quit);
    child.on("error", quit);
  };

  switch (event) {
    case "--squirrel-install":
    case "--squirrel-updated":
      // one argument, with "=": the form Update.exe parses. Desktop and Start menu by default.
      run([`--createShortcut=${exe}`]);
      return true;
    case "--squirrel-uninstall":
      run([`--removeShortcut=${exe}`]);
      return true;
    default:
      quit();
      return true;
  }
}
