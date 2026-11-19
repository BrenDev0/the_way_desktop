import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSensitive, PROTECTED, splitComputerPath } from "../core/computer/access";
import { ToolError } from "../core/tools/contract";
import type { ComputerPort, DirectoryEntry, FileInfo, WalkEntry } from "../core/tools/ports";
import type { ComputerGrants } from "./computerGrants";

/**
 * The folders the user granted, read-only. There is no write here by construction. The fence
 * is in one place, like the open folder's: every path is "<granted name>/<inside>", its real
 * location -- symlinks followed -- must stay inside that grant, and credentials and keys are
 * neither listed, walked nor read.
 */
export class NodeComputer implements ComputerPort {
  constructor(
    private readonly store: ComputerGrants,
    private readonly pick: (reason: string) => Promise<string | null>,
  ) {}

  async grants(): Promise<{ label: string }[]> {
    return (await this.store.list()).map(({ label }) => ({ label }));
  }

  async choose(reason: string): Promise<{ label: string } | null> {
    const picked = await this.pick(reason);
    if (!picked) return null;
    const { label } = await this.store.add(picked);
    return { label };
  }

  async stat(path: string): Promise<FileInfo> {
    const { absolute } = await this.inside(path);
    try {
      const info = await stat(absolute);
      return { exists: true, isDirectory: info.isDirectory(), size: info.isDirectory() ? 0 : info.size };
    } catch {
      return { exists: false, isDirectory: false, size: 0 };
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const { absolute, rest } = await this.inside(path);
    if (isSensitive(rest)) throw new ToolError(PROTECTED);
    return new Uint8Array(await readFile(absolute));
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const { absolute, rest } = await this.inside(path);
    if (isSensitive(rest)) throw new ToolError(PROTECTED);
    const entries = await readdir(absolute, { withFileTypes: true });
    const shown = entries.filter((entry) => !entry.isSymbolicLink() && !isSensitive(entry.name));
    return Promise.all(
      shown.map(async (entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : (await stat(join(absolute, entry.name)).catch(() => ({ size: 0 }))).size,
      })),
    );
  }

  async *walk(path: string, enter: (name: string) => boolean, signal?: AbortSignal): AsyncIterable<WalkEntry> {
    signal?.throwIfAborted();
    const { absolute, label, rest } = await this.inside(path);
    if (isSensitive(rest)) return;
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    const base = rest ? `${label}/${rest}` : label;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      signal?.throwIfAborted();
      if (entry.isSymbolicLink() || isSensitive(entry.name)) continue;
      const child = `${base}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!enter(entry.name)) continue;
        yield { path: child, isDirectory: true, size: 0 };
        yield* this.walk(child, enter, signal);
      } else if (entry.isFile()) {
        const size = await lstat(join(absolute, entry.name)).then((s) => s.size, () => 0);
        yield { path: child, isDirectory: false, size };
      }
    }
  }

  private async inside(path: string): Promise<{ absolute: string; label: string; rest: string }> {
    const { label, rest } = splitComputerPath(path);
    const grants = await this.store.list();
    const grant = grants.find((g) => g.label.toLowerCase() === label.toLowerCase());
    if (!grant) {
      const granted = grants.map((g) => `'${g.label}'`).join(", ") || "none yet";
      throw new ToolError(`'${label}' is not a folder the user has granted. Granted: ${granted}.`);
    }

    const realRoot = await realpath(grant.path).catch(() => {
      throw new ToolError(`The folder '${grant.label}' is not available right now (moved, deleted or unplugged).`);
    });
    const candidate = resolve(realRoot, rest);

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
      throw new ToolError(`Path '${path}' resolves outside the granted folder`);
    }
    return { absolute: candidate, label: grant.label, rest };
  }
}
