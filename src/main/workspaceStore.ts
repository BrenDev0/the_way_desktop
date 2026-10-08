import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkingPlace } from "../core/bridge";

interface Saved {
  owner?: unknown;
  folder?: unknown;
  mode?: unknown;
  remote?: unknown;
}

/**
 * Where the user works, remembered between runs: a folder on this computer (the one the
 * local file tools work in), a folder in one of their projects on the server, and which
 * of the two is the one in use now.
 *
 * It is remembered for one account. Whoever signs in next on this computer must not start
 * in the last person's folders, so claim() is called with every signed-in user and wipes
 * the place when it belongs to someone else (or to nobody: a file from before owners).
 */
export class WorkspaceStore {
  private readonly path: string;
  private owner: string | null = null;
  private folder: string | null | undefined;
  private mode: "local" | "remote" = "local";
  private remote: { project: string; path: string } | null = null;

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, "workspace.json");
  }

  /** Makes the remembered place this user's. True when it was someone else's and has been
   *  wiped -- the caller then clears whatever else the last account left behind. */
  async claim(userId: string): Promise<boolean> {
    await this.current();
    if (this.owner === userId) return false;
    this.owner = userId;
    this.folder = null;
    this.mode = "local";
    this.remote = null;
    await this.save();
    return true;
  }

  /** The local folder -- what the local file tools are fenced to, whichever side is in use. */
  async current(): Promise<string | null> {
    if (this.folder !== undefined) return this.folder;
    let saved: Saved = {};
    try {
      saved = JSON.parse(await readFile(this.path, "utf8")) as Saved;
    } catch {
      saved = {};
    }
    this.owner = typeof saved.owner === "string" ? saved.owner : null;
    const folder = typeof saved.folder === "string" ? saved.folder : null;
    // a folder deleted or unplugged since is treated as none, not as an error later
    this.folder = folder && (await stat(folder).then((s) => s.isDirectory(), () => false)) ? folder : null;
    const remote = saved.remote as { project?: unknown; path?: unknown } | null | undefined;
    this.remote = remote && typeof remote.project === "string"
      ? { project: remote.project, path: typeof remote.path === "string" ? remote.path : "" }
      : null;
    this.mode = saved.mode === "remote" && this.remote ? "remote" : "local";
    return this.folder;
  }

  async place(): Promise<WorkingPlace> {
    const local = await this.current();
    return { mode: this.mode, local, remote: this.remote };
  }

  /** A folder on this computer, chosen -- and now the one in use. */
  async set(folder: string): Promise<void> {
    this.folder = folder;
    this.mode = "local";
    await this.save();
  }

  /** A folder in a project on the server, chosen -- and now the one in use. */
  async setRemote(project: string, path: string): Promise<void> {
    await this.current();
    this.remote = { project, path: path.replace(/^\/+|\/+$/g, "") };
    this.mode = "remote";
    await this.save();
  }

  /** Back to one already chosen, without choosing again. */
  async use(mode: "local" | "remote"): Promise<void> {
    await this.current();
    this.mode = mode === "remote" && this.remote ? "remote" : "local";
    await this.save();
  }

  private async save(): Promise<void> {
    await writeFile(
      this.path,
      JSON.stringify({ owner: this.owner, folder: this.folder ?? null, mode: this.mode, remote: this.remote }),
      "utf8",
    );
  }
}
