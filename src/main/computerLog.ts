import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComputerActivity } from "../core/computer/access";

const MAX_ENTRIES = 500;

interface Saved {
  owner?: unknown;
  entries?: unknown;
}

/**
 * What the agent did on the user's computer, kept on this computer for the user to read:
 * which folders were opened to it, and every search and read. One account's record, oldest
 * dropped past a few hundred, wiped when someone else signs in.
 */
export class ComputerLog {
  private readonly path: string;
  private owner: string | null = null;
  private entries: ComputerActivity[] | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    userDataDirectory: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.path = join(userDataDirectory, "computer-log.json");
  }

  async claim(userId: string): Promise<void> {
    await this.load();
    if (this.owner === userId) return;
    this.owner = userId;
    this.entries = [];
    await this.save();
  }

  append(entry: Omit<ComputerActivity, "at">): Promise<void> {
    const next = this.queue.then(async () => {
      const entries = await this.load();
      entries.push({ at: this.now().toISOString(), ...entry });
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      await this.save();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async recent(limit = 100): Promise<ComputerActivity[]> {
    await this.queue;
    return [...(await this.load())].reverse().slice(0, limit);
  }

  async clear(): Promise<void> {
    await this.queue;
    this.entries = [];
    await this.save();
  }

  private async load(): Promise<ComputerActivity[]> {
    if (this.entries) return this.entries;
    let saved: Saved = {};
    try {
      saved = JSON.parse(await readFile(this.path, "utf8")) as Saved;
    } catch {
      saved = {};
    }
    this.owner = typeof saved.owner === "string" ? saved.owner : null;
    this.entries = this.owner && Array.isArray(saved.entries) ? saved.entries.filter(isActivity) : [];
    return this.entries;
  }

  private async save(): Promise<void> {
    await writeFile(this.path, JSON.stringify({ owner: this.owner, entries: this.entries ?? [] }));
  }
}

function isActivity(value: unknown): value is ComputerActivity {
  const entry = value as Partial<ComputerActivity> | null;
  return !!entry && typeof entry.at === "string" && typeof entry.tool === "string" && typeof entry.detail === "string" && typeof entry.ok === "boolean";
}
