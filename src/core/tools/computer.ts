import { optionalText, text, ToolError, type ToolArgs, type ToolRegistry } from "./contract";
import { IGNORED_DIRS } from "./files";
import type { ComputerPort } from "./ports";
import { decodeText } from "./text";

const SEARCH_LIMIT = 50;
const MAX_SCANNED = 300_000;
const MAX_READ_BYTES = 2_000_000;

const bytes = (n: number) => n.toLocaleString("en-US");

export function computerTools(computer: ComputerPort): ToolRegistry {
  async function requestAccess(args: ToolArgs): Promise<string> {
    const reason = text(args, "reason").trim().slice(0, 300);
    if (!reason) throw new ToolError("'reason' is required: say what you are looking for");
    const granted = await computer.choose(reason);
    if (!granted) {
      return "The user did not pick a folder, so you have no access. Carry on without it, and do not ask again unless they ask you to.";
    }
    return `Read-only access granted to '${granted.label}'. Use paths like '${granted.label}/...'.`;
  }

  async function listFolder(args: ToolArgs): Promise<string> {
    const path = optionalText(args, "path", "").trim();
    if (!path) {
      const granted = await computer.grants();
      if (granted.length === 0) {
        return "No folder has been granted yet. Ask the user with RequestComputerAccess.";
      }
      return granted.map((grant) => `${grant.label}/`).join("\n");
    }
    const info = await computer.stat(path);
    if (!info.exists) throw new ToolError(`Folder does not exist: ${path}`);
    if (!info.isDirectory) throw new ToolError(`'${path}' is a file, not a folder. Use ReadComputerFile`);

    const entries = [...(await computer.list(path))].sort(
      (a, b) => Number(!a.isDirectory) - Number(!b.isDirectory) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
    const lines = entries.map((e) => (e.isDirectory ? `${e.name}/` : `${e.name}  (${bytes(e.size)} bytes)`));
    return lines.join("\n") || "(empty folder)";
  }

  async function search(args: ToolArgs, signal?: AbortSignal): Promise<string> {
    const query = text(args, "query");
    const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (terms.length === 0) return "Give something to search for -- a filename, a word from one, or a folder name.";

    const wanted = optionalText(args, "path", "").trim();
    const targets = wanted ? [wanted] : (await computer.grants()).map((grant) => grant.label);
    if (targets.length === 0) return "No folder has been granted yet. Ask the user with RequestComputerAccess.";

    const hits: { nameHits: number; path: string; isDirectory: boolean }[] = [];
    let scanned = 0;
    let cut = false;
    for (const target of targets) {
      for await (const entry of computer.walk(target, (name) => !IGNORED_DIRS.has(name), signal)) {
        signal?.throwIfAborted();
        scanned += 1;
        if (scanned > MAX_SCANNED) {
          cut = true;
          break;
        }
        const haystack = entry.path.toLowerCase();
        if (!terms.every((term) => haystack.includes(term))) continue;
        const name = entry.path.split("/").pop()!.toLowerCase();
        hits.push({ nameHits: terms.filter((t) => name.includes(t)).length, path: entry.path, isDirectory: entry.isDirectory });
      }
      if (cut) break;
    }

    const note = cut ? ` Stopped after ${bytes(MAX_SCANNED)} entries; narrow it with 'path'.` : "";
    if (hits.length === 0) {
      return `Nothing matches all of [${terms.join(", ")}] in ${wanted || "the granted folders"} (searched ${bytes(scanned)} entries).${note}`;
    }
    hits.sort((a, b) => b.nameHits - a.nameHits || a.path.length - b.path.length || a.path.localeCompare(b.path));
    const lines = hits.slice(0, SEARCH_LIMIT).map((h) => (h.isDirectory ? `${h.path}/` : h.path));
    if (hits.length > SEARCH_LIMIT) lines.push(`... and ${hits.length - SEARCH_LIMIT} more; narrow the query or set 'path'`);
    if (note) lines.push(note.trim());
    return lines.join("\n");
  }

  async function read(args: ToolArgs): Promise<string> {
    const path = text(args, "path").trim();
    const info = await computer.stat(path);
    if (!info.exists) throw new ToolError(`File does not exist: ${path}`);
    if (info.isDirectory) throw new ToolError(`'${path}' is a folder, not a file. Use ListComputerFolder`);
    if (info.size > MAX_READ_BYTES) {
      throw new ToolError(`'${path}' is ${bytes(info.size)} bytes, over the ${bytes(MAX_READ_BYTES)} that can be read at once.`);
    }
    return decodeText(await computer.readBytes(path), path);
  }

  return {
    RequestComputerAccess: { run: requestAccess, preview: async (args) => `Motivo: ${optionalText(args, "reason", "")}` },
    ListComputerFolder: { run: listFolder },
    SearchComputer: { run: search },
    ReadComputerFile: { run: read },
  };
}
