import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isHomeNoise, isSensitive, NOISE, PROTECTED, splitComputerPath, type ComputerGrant } from "../core/computer/access";
import { cloudOnlyMessage, isCloudOnly } from "../core/computer/cloud";
import { ToolError } from "../core/tools/contract";
import type { ComputerPort, DirectoryEntry, FileInfo, WalkEntry } from "../core/tools/ports";
import type { ComputerGrants } from "./computerGrants";
import type { ComputerLog } from "./computerLog";
import type { SearchKind, SystemSearch } from "./systemSearch";

const MAX_INDEXED = 500;

/** What the user answered when asked to allow searching their computer. */
export type AccessChoice = { kind: "home" } | { kind: "folder"; path: string };

export interface ComputerPrompts {
  /** The question the agent asks: search the user's folder, pick one folder, or refuse. */
  ask(reason: string): Promise<AccessChoice | null>;
  /** The system's folder picker, for adding a folder by hand. */
  folder(): Promise<string | null>;
}

export interface NodeComputerOptions {
  system?: SystemSearch | null;
  log?: ComputerLog | null;
  cloudOnly?: (size: number, blocks: number | undefined) => boolean;
  home?: string;
}

/**
 * What the user opened to the agent, read-only. There is no write here by construction. The
 * fence is in one place, like the open folder's: every path is "<granted name>/<inside>", its
 * real location -- symlinks followed -- must stay inside that grant, and credentials, keys and,
 * in the user's own folder, program and app data are neither listed, walked nor read.
 */
export class NodeComputer implements ComputerPort {
  private readonly system: SystemSearch | null;
  private readonly log: ComputerLog | null;
  private readonly cloudOnly: (size: number, blocks: number | undefined) => boolean;
  private readonly home: string;

  constructor(
    private readonly store: ComputerGrants,
    private readonly prompts: ComputerPrompts,
    private readonly extract: (name: string, data: Uint8Array) => Promise<string>,
    options: NodeComputerOptions = {},
  ) {
    this.system = options.system ?? null;
    this.log = options.log ?? null;
    this.cloudOnly = options.cloudOnly ?? isCloudOnly;
    this.home = options.home ?? homedir();
  }

  async grants(): Promise<{ label: string }[]> {
    return (await this.store.list()).map(({ label }) => ({ label }));
  }

  async choose(reason: string): Promise<{ label: string; home?: boolean } | null> {
    const existing = (await this.store.list()).find((grant) => grant.kind === "home");
    if (existing) return { label: existing.label, home: true };
    const choice = await this.prompts.ask(reason);
    if (!choice) return null;
    return choice.kind === "home" ? this.addHome() : this.record(await this.store.add(choice.path));
  }

  async addHome(): Promise<{ label: string; home: true }> {
    const grant = await this.store.addHome(this.home);
    this.record(grant);
    return { label: grant.label, home: true };
  }

  async addFolder(): Promise<{ label: string } | null> {
    const picked = await this.prompts.folder();
    return picked ? this.record(await this.store.add(picked)) : null;
  }

  private record(grant: ComputerGrant): { label: string } {
    void this.log?.append({ tool: "GrantAdded", detail: grant.label, ok: true }).catch(() => undefined);
    return { label: grant.label };
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
    const { absolute, grant, rest } = await this.inside(path);
    this.refuse(grant, rest);
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
    const { absolute, grant, rest } = await this.inside(path);
    if (this.hidden(grant, rest)) return [];
    const realScope = await realpath(absolute).catch(() => null);
    const realRoot = await realpath(grant.path).catch(() => null);
    if (!realScope || !realRoot) return null;

    const found = await this.system.search(realScope, terms, kind, signal);
    if (!found) return null;

    const entries: WalkEntry[] = [];
    for (const file of found.slice(0, MAX_INDEXED)) {
      signal?.throwIfAborted();
      const real = await realpath(file).catch(() => null);
      if (!real) continue;
      const offset = relative(realRoot, real);
      if (!offset || offset.startsWith("..") || isAbsolute(offset) || this.hidden(grant, offset)) continue;
      const info = await stat(real).catch(() => null);
      if (!info) continue;
      const directory = info.isDirectory();
      entries.push({
        path: `${grant.label}/${offset.split(sep).join("/")}`,
        isDirectory: directory,
        size: directory ? 0 : info.size,
        cloudOnly: !directory && this.cloudOnly(info.size, info.blocks),
      });
    }
    return entries;
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const { absolute, grant, rest } = await this.inside(path);
    this.refuse(grant, rest);
    const entries = await readdir(absolute, { withFileTypes: true });
    const shown = entries.filter((entry) => !entry.isSymbolicLink() && !this.hidden(grant, rest ? `${rest}/${entry.name}` : entry.name));
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
    const { absolute, grant, rest } = await this.inside(path);
    if (this.hidden(grant, rest)) return;
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    const base = rest ? `${grant.label}/${rest}` : grant.label;
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      signal?.throwIfAborted();
      if (entry.isSymbolicLink() || this.hidden(grant, rest ? `${rest}/${entry.name}` : entry.name)) continue;
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

  private hidden(grant: ComputerGrant, rest: string): boolean {
    return isSensitive(rest) || (grant.kind === "home" && isHomeNoise(rest));
  }

  private refuse(grant: ComputerGrant, rest: string): void {
    if (isSensitive(rest)) throw new ToolError(PROTECTED);
    if (grant.kind === "home" && isHomeNoise(rest)) throw new ToolError(NOISE);
  }

  private async inside(path: string): Promise<{ absolute: string; grant: ComputerGrant; rest: string }> {
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
    return { absolute: candidate, grant, rest };
  }
}
