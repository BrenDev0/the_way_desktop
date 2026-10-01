import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkingPlace } from "../core/bridge";

interface Saved {
  folder?: unknown;
  mode?: unknown;
  remote?: unknown;
}

/**
 * Where the user works, remembered between runs: a folder on this computer (the one the
 * local file tools work in), a folder in one of their projects on the server, and which
 * of the two is the one in use now.
 */
export class WorkspaceStore {
  private readonly path: string;
  private folder: string | null | undefined;
  private mode: "local" | "remote" = "local";
  private remote: { project: string; path: string } | null = null;

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, "workspace.json");
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
    await writeFile(this.path, JSON.stringify({ folder: this.folder ?? null, mode: this.mode, remote: this.remote }), "utf8");
  }
}
