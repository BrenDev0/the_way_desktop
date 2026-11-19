import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSensitive, PROTECTED, splitComputerPath } from "../core/computer/access";
import { cloudOnlyMessage, isCloudOnly } from "../core/computer/cloud";
import { ToolError } from "../core/tools/contract";
import type { ComputerPort, DirectoryEntry, FileInfo, WalkEntry } from "../core/tools/ports";
import type { ComputerGrants } from "./computerGrants";
import type { ComputerLog } from "./computerLog";
import type { SearchKind, SystemSearch } from "./systemSearch";

const MAX_INDEXED = 500;

/**
 * The folders the user granted, read-only. There is no write here by construction. The fence
 * is in one place, like the open folder's: every path is "<granted name>/<inside>", its real
 * location -- symlinks followed -- must stay inside that grant, and credentials and keys are
 * neither listed, walked nor read.
 */
export interface NodeComputerOptions {
  system?: SystemSearch | null;
  log?: ComputerLog | null;
  cloudOnly?: (size: number, blocks: number | undefined) => boolean;
}

export class NodeComputer implements ComputerPort {
  private readonly system: SystemSearch | null;
  private readonly log: ComputerLog | null;
  private readonly cloudOnly: (size: number, blocks: number | undefined) => boolean;

  constructor(
    private readonly store: ComputerGrants,
    private readonly pick: (reason: string) => Promise<string | null>,
    private readonly extract: (name: string, data: Uint8Array) => Promise<string>,
    options: NodeComputerOptions = {},
  ) {
    this.system = options.system ?? null;
    this.log = options.log ?? null;
    this.cloudOnly = options.cloudOnly ?? isCloudOnly;
  }

  async grants(): Promise<{ label: string }[]> {
    return (await this.store.list()).map(({ label }) => ({ label }));
  }

  async choose(reason: string): Promise<{ label: string } | null> {
    const picked = await this.pick(reason);
    if (!picked) return null;
    const { label } = await this.store.add(picked);
    void this.log?.append({ tool: "GrantAdded", detail: label, ok: true }).catch(() => undefined);
    return { label };
  }

  async stat(path: string): Promise<FileInfo> {
    const { absolute } = await this.inside(path);
    try {
      const info = await stat(absolute);
      const directory = info.isDirectory();
      return { exists: true, isDirectory: directory, size: directory ? 0 : info.size, cloudOnly: !directory && this.cloudOnly(info.size, info.blocks) };
    } catch {
      return { exists: false, isDirectory: false, size: 0 };
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const { absolute, rest } = await this.inside(path);
    if (isSensitive(rest)) throw new ToolError(PROTECTED);
    const info = await stat(absolute);
    if (info.isFile() && this.cloudOnly(info.size, info.blocks)) throw new ToolError(cloudOnlyMessage(path));
    return new Uint8Array(await readFile(absolute));
  }

  async document(path: string): Promise<string> {
    const data = await this.readBytes(path);
    return this.extract(path.split("/").pop() ?? path, data);
  }

  async indexed(path: string, terms: string[], kind: SearchKind, signal?: AbortSignal): Promise<WalkEntry[] | null> {
    if (!this.system) return null;
    const { absolute, label, rest } = await this.inside(path);
    if (isSensitive(rest)) return [];
    const realScope = await realpath(absolute).catch(() => null);
    const grant = (await this.store.list()).find((g) => g.label === label);
    const realRoot = grant ? await realpath(grant.path).catch(() => null) : null;
    if (!realScope || !realRoot) return null;

    const found = await this.system.search(realScope, terms, kind, signal);
    if (!found) return null;

    const entries: WalkEntry[] = [];
    for (const file of found.slice(0, MAX_INDEXED)) {
      signal?.throwIfAborted();
      const real = await realpath(file).catch(() => null);
      if (!real) continue;
      const offset = relative(realRoot, real);
      if (!offset || offset.startsWith("..") || isAbsolute(offset) || isSensitive(offset)) continue;
      const info = await stat(real).catch(() => null);
      if (!info) continue;
      const directory = info.isDirectory();
      entries.push({
        path: `${label}/${offset.split(sep).join("/")}`,
        isDirectory: directory,
        size: directory ? 0 : info.size,
        cloudOnly: !directory && this.cloudOnly(info.size, info.blocks),
      });
    }
    return entries;
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const { absolute, rest } = await this.inside(path);
    if (isSensitive(rest)) throw new ToolError(PROTECTED);
    const entries = await readdir(absolute, { withFileTypes: true });
    const shown = entries.filter((entry) => !entry.isSymbolicLink() && !isSensitive(entry.name));
    return Promise.all(
      shown.map(async (entry) => {
        const directory = entry.isDirectory();
        const info = directory ? null : await stat(join(absolute, entry.name)).catch(() => null);
        return {
          name: entry.name,
          isDirectory: directory,
          size: info?.size ?? 0,
          cloudOnly: !!info && this.cloudOnly(info.size, info.blocks),
        };
      }),
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
        const info = await lstat(join(absolute, entry.name)).catch(() => null);
        yield { path: child, isDirectory: false, size: info?.size ?? 0, cloudOnly: !!info && this.cloudOnly(info.size, info.blocks) };
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
