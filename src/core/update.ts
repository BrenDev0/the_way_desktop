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
