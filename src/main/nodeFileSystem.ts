import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ToolError } from "../core/tools/contract";
import type { DirectoryEntry, FileInfo, FileSystemPort, WalkEntry } from "../core/tools/ports";

const NO_FOLDER =
  "No folder is open in the desktop app, so there is nothing to work in. Ask the user to " +
  "choose one with the folder button, then try again.";

/**
 * The real disk, fenced to the folder the user opened. The fence is here, once, rather
 * than in each tool: every path is resolved against the open folder, and its real
 * location -- symlinks followed -- must stay inside it before anything is read or written.
 */
export class NodeFileSystem implements FileSystemPort {
  constructor(private readonly root: () => Promise<string | null>) {}

  normalize(path: string): string {
    const cleaned = path.replace(/\\/g, "/").trim();
    if (isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
      throw new ToolError(`'${path}' is an absolute path; paths are relative to the open folder`);
    }
    const parts: string[] = [];
    for (const part of cleaned.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) throw new ToolError(`Path '${path}' resolves outside the open folder`);
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    return parts.join("/");
  }

  async stat(path: string): Promise<FileInfo> {
    const absolute = await this.inside(path);
    try {
      const info = await stat(absolute);
      return { exists: true, isDirectory: info.isDirectory(), size: info.isDirectory() ? 0 : info.size };
    } catch {
      return { exists: false, isDirectory: false, size: 0 };
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(await this.inside(path)));
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const absolute = await this.inside(path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const absolute = await this.inside(path);
    const entries = await readdir(absolute, { withFileTypes: true });
    return Promise.all(
      entries
        .filter((entry) => !entry.isSymbolicLink())
        .map(async (entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? 0 : (await stat(join(absolute, entry.name))).size,
        })),
    );
  }

  async *walk(path: string, enter: (name: string) => boolean): AsyncIterable<WalkEntry> {
    const base = this.normalize(path);
    const absolute = await this.inside(base);
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return; // unreadable folders are skipped, not fatal to a whole search
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      // Links are not followed: a link to somewhere else is how a walk leaves the folder.
      if (entry.isSymbolicLink()) continue;
      const child = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!enter(entry.name)) continue;
        yield { path: child, isDirectory: true, size: 0 };
        yield* this.walk(child, enter);
      } else if (entry.isFile()) {
        const size = await lstat(join(absolute, entry.name)).then((s) => s.size, () => 0);
        yield { path: child, isDirectory: false, size };
      }
    }
  }

  async makeDirectory(path: string): Promise<void> {
    await mkdir(await this.inside(path), { recursive: true });
  }

  async copy(source: string, target: string): Promise<void> {
    const to = await this.inside(target);
    await mkdir(dirname(to), { recursive: true });
    await cp(await this.inside(source), to, { recursive: true, errorOnExist: true, force: false });
  }

  async move(source: string, target: string): Promise<void> {
    const from = await this.inside(source);
    const to = await this.inside(target);
    await mkdir(dirname(to), { recursive: true });
    try {
      await rename(from, to);
    } catch (error) {
      // across drives a rename is impossible; copy then remove does the same job
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await cp(from, to, { recursive: true, errorOnExist: true, force: false });
      await rm(from, { recursive: true });
    }
  }

  async remove(path: string, recursive: boolean): Promise<void> {
    const absolute = await this.inside(path);
    const info = await lstat(absolute);
    if (!info.isDirectory()) await unlink(absolute);
    else if (recursive) await rm(absolute, { recursive: true });
    else await rmdir(absolute);
  }

  /** The absolute path of an entry, for showing it in Explorer; fenced like every other call. */
  locate(path: string): Promise<string> {
    return this.inside(path);
  }

  /** The absolute path, once it is certain to stay inside the open folder. */
  private async inside(path: string): Promise<string> {
    const folder = await this.root();
    if (!folder) throw new ToolError(NO_FOLDER);

    const realRoot = await realpath(folder);
    const candidate = resolve(realRoot, this.normalize(path));

    // The deepest part of the path that exists decides where it really points.
    let existing = candidate;
    for (;;) {
      try {
        existing = await realpath(existing);
        break;
      } catch {
        const parent = dirname(existing);
        if (parent === existing) break;
        existing = parent;
      }
    }
    const offset = relative(realRoot, existing);
    if (offset.startsWith("..") || isAbsolute(offset) || offset.split(sep)[0] === "..") {
      throw new ToolError(`Path '${path}' resolves outside the open folder`);
    }
    return candidate;
  }
}
