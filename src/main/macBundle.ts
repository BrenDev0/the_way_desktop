import { readFile } from "node:fs/promises";
import { app } from "electron";
import { bundleOf, versionFromPlist } from "../core/bundleVersion";
import { isNewer } from "../core/update";

export async function replacedByNewerVersion(): Promise<boolean> {
  const bundle = bundleOf(process.execPath);
  if (process.platform !== "darwin" || !bundle) return false;
  try {
    const installed = versionFromPlist(await readFile(`${bundle}/Contents/Info.plist`, "utf8"));
    return installed !== null && isNewer(installed, app.getVersion());
  } catch {
    return false;
  }
}
