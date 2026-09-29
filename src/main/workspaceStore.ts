import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The folder the local file tools work in, remembered between runs. */
export class WorkspaceStore {
  private readonly path: string;
  private folder: string | null | undefined;

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, "workspace.json");
  }

  async current(): Promise<string | null> {
    if (this.folder !== undefined) return this.folder;
    try {
      const saved = JSON.parse(await readFile(this.path, "utf8")) as { folder?: unknown };
      const folder = typeof saved.folder === "string" ? saved.folder : null;
      // a folder deleted or unplugged since is treated as none, not as an error later
      this.folder = folder && (await stat(folder).then((s) => s.isDirectory(), () => false)) ? folder : null;
    } catch {
      this.folder = null;
    }
    return this.folder;
  }

  async set(folder: string): Promise<void> {
    await writeFile(this.path, JSON.stringify({ folder }), "utf8");
    this.folder = folder;
  }
}
