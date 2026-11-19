import { randomUUID } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isSensitive, labelFor, type ComputerGrant } from "../core/computer/access";
import { ToolError } from "../core/tools/contract";

interface Saved {
  owner?: unknown;
  grants?: unknown;
}

/**
 * The folders this account has opened to the agent, read-only, remembered between runs.
 * Like the workspace, they belong to one account: whoever signs in next starts with none.
 */
export class ComputerGrants {
  private readonly path: string;
  private owner: string | null = null;
  private grants: ComputerGrant[] | undefined;

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, "computer-grants.json");
  }

  async claim(userId: string): Promise<void> {
    await this.list();
    if (this.owner === userId) return;
    this.owner = userId;
    this.grants = [];
    await this.save();
  }

  async list(): Promise<ComputerGrant[]> {
    if (this.grants) return [...this.grants];
    let saved: Saved = {};
    try {
      saved = JSON.parse(await readFile(this.path, "utf8")) as Saved;
    } catch {
      saved = {};
    }
    this.owner = typeof saved.owner === "string" ? saved.owner : null;
    this.grants = this.owner && Array.isArray(saved.grants) ? saved.grants.filter(isGrant) : [];
    return [...this.grants];
  }

  async add(path: string): Promise<ComputerGrant> {
    const real = await realpath(path).catch(() => null);
    if (!real || !(await stat(real)).isDirectory()) throw new ToolError("That folder is not available.");
    if (dirname(real) === real) throw new ToolError("A whole drive cannot be opened to the agent. Pick a folder inside it.");
    if (isSensitive(real) || isSensitive(basename(real))) throw new ToolError("That folder holds credentials or keys and cannot be opened to the agent.");

    const grants = await this.list();
    for (const existing of grants) {
      if ((await realpath(existing.path).catch(() => null)) === real) return existing;
    }
    const grant = { id: randomUUID(), label: labelFor(real, grants.map((g) => g.label)), path: real };
    this.grants = [...grants, grant];
    await this.save();
    return grant;
  }

  async addHome(path: string): Promise<ComputerGrant> {
    const real = await realpath(path).catch(() => null);
    if (!real || !(await stat(real)).isDirectory()) throw new ToolError("The user's folder is not available.");
    const grants = await this.list();
    const existing = grants.find((grant) => grant.kind === "home");
    if (existing) return existing;
    const grant: ComputerGrant = { id: randomUUID(), label: labelFor("Usuario", grants.map((g) => g.label)), path: real, kind: "home" };
    this.grants = [...grants, grant];
    await this.save();
    return grant;
  }

  async remove(id: string): Promise<ComputerGrant[]> {
    this.grants = (await this.list()).filter((grant) => grant.id !== id);
    await this.save();
    return [...this.grants];
  }

  private async save(): Promise<void> {
    await writeFile(this.path, JSON.stringify({ owner: this.owner, grants: this.grants ?? [] }));
  }
}

function isGrant(value: unknown): value is ComputerGrant {
  const grant = value as Partial<ComputerGrant> | null;
  return (
    !!grant &&
    typeof grant.id === "string" &&
    typeof grant.label === "string" &&
    typeof grant.path === "string" &&
    (grant.kind === undefined || grant.kind === "home")
  );
}
