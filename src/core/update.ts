/**
 * Whether a newer version of the app is out. The backend reports the latest published
 * version for each platform (written when an installer is published); the app compares
 * its own and, when it is behind, offers the download page. Nothing installs by itself:
 * the operator downloads the new installer and runs it.
 */

export interface AppUpdate {
  current: string;
  latest: string;
  /** The public download page, or null when the server does not know it. */
  downloadPageUrl: string | null;
}

export interface AppVersionAnswer {
  latest: Record<string, string | null>;
  downloadPageUrl?: string | null;
}

/** The platform names the backend uses for each installer. */
export function platformOf(nodePlatform: string): "windows" | "mac" | null {
  if (nodePlatform === "win32") return "windows";
  if (nodePlatform === "darwin") return "mac";
  return null;
}

/** True when `latest` is a higher x.y.z than `current`. Anything else -- a missing or
 *  malformed number on either side -- is no update: a notice must never be wrong. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function updateFrom(answer: AppVersionAnswer, current: string, nodePlatform: string): AppUpdate | null {
  const platform = platformOf(nodePlatform);
  const latest = platform ? answer.latest?.[platform] : null;
  if (!latest || !isNewer(latest, current)) return null;
  const page = answer.downloadPageUrl ?? null;
  return { current, latest, downloadPageUrl: page && /^https:\/\//.test(page) ? page : null };
}

/** What one check found, for the line in the window that shows the version and checks on
 *  request. Unlike `AppUpdate` it tells "up to date" from "nothing published" from "could not
 *  ask", so the person can see whether the check works at all. */
export interface UpdateCheck {
  current: string;
  /** The latest the server has for this computer: null when none is recorded. */
  latest: string | null;
  /** Set when `latest` is newer than `current`. */
  update: AppUpdate | null;
  /** The server could not be asked. */
  failed: boolean;
}

export function checkFrom(answer: AppVersionAnswer, current: string, nodePlatform: string): UpdateCheck {
  const platform = platformOf(nodePlatform);
  const latest = (platform ? answer.latest?.[platform] : null) ?? null;
  return { current, latest, update: updateFrom(answer, current, nodePlatform), failed: false };
}

export function failedCheck(current: string): UpdateCheck {
  return { current, latest: null, update: null, failed: true };
}

/** What the window says about a check: the installed version, one line on where it stands,
 *  and the update to offer, if there is one. `null` is a check not yet answered. */
export function describeCheck(check: UpdateCheck | null): {
  version: string | null;
  text: string;
  update: AppUpdate | null;
} {
  if (!check) return { version: null, text: "Comprobando…", update: null };
  const version = check.current;
  if (check.failed) return { version, text: "No se pudo comprobar. Revisa tu conexión.", update: null };
  if (check.update) return { version, text: `Hay una versión nueva (${check.update.latest}).`, update: check.update };
  if (!check.latest) return { version, text: "Aún no hay versiones publicadas.", update: null };
  return { version, text: "Estás al día.", update: null };
}
