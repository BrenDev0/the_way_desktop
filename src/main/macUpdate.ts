import { execFile, spawn } from "node:child_process";
import { access, constants, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { bundleOf, versionFromPlist } from "../core/bundleVersion";
import { isNewer } from "../core/update";
import { FriendlyError } from "../core/userMessages";

const run = promisify(execFile);

export const SWAP_SCRIPT = `
pid="$1"; new="$2"; target="$3"; staging="$4"
tries=0
while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 100 ]; do sleep 0.3; tries=$((tries + 1)); done
old="$staging/previous.app"
if mv "$target" "$old"; then
  if ! mv "$new" "$target"; then mv "$old" "$target"; fi
fi
rm -rf "$staging"
open "$target"
`;

export async function replaceMacApp(zip: string, running: { executable: string; version: string; pid: number }): Promise<void> {
  const target = bundleOf(running.executable);
  if (!target) throw new FriendlyError("No se encontró dónde está instalada la app. Descarga la nueva versión desde la página.");
  const parent = dirname(target);
  try {
    await access(parent, constants.W_OK);
  } catch {
    throw new FriendlyError(`La app no puede reemplazarse a sí misma en «${parent}». Descarga la nueva versión desde la página.`);
  }

  const staging = await mkdtemp(join(parent, ".the-way-update-"));
  try {
    await run("/usr/bin/ditto", ["-x", "-k", zip, staging]);
    const bundle = (await readdir(staging)).find((name) => name.endsWith(".app"));
    if (!bundle) throw new FriendlyError("El archivo descargado no contiene la app.");
    const fresh = join(staging, bundle);

    const version = versionFromPlist(await readFile(join(fresh, "Contents", "Info.plist"), "utf8"));
    if (!version || !isNewer(version, running.version)) {
      throw new FriendlyError("El archivo descargado no es una versión más nueva que la instalada, así que no se cambió nada.");
    }

    await run("/usr/bin/xattr", ["-cr", fresh]);
    const child = spawn("/bin/sh", ["-c", SWAP_SCRIPT, "the-way-update", String(running.pid), fresh, target, staging], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof FriendlyError) throw error;
    throw new FriendlyError("No se pudo preparar la nueva versión. Descárgala desde la página.");
  }
}
