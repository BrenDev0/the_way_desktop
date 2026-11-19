import type { ComputerActivity } from "../computer/access";
import { cloudOnlyMessage } from "../computer/cloud";
import { foldText, hasAllTerms, rawTermsOf, snippetOf, termsOf, TEXT_FILE } from "../computer/search";
import { flag, optionalText, text, ToolError, type ToolArgs, type ToolRegistry } from "./contract";
import { IGNORED_DIRS } from "./files";
import type { ComputerPort, WalkEntry } from "./ports";
import { decodeText } from "./text";

const SEARCH_LIMIT = 50;
const TEXT_SEARCH_LIMIT = 30;
const SMALL_FOLDER_ENTRIES = 5_000;
const SMALL_FOLDER_BYTES = 50 * 1024 * 1024;
const MAX_SCANNED = 300_000;
const MAX_SCAN_BYTES = 300 * 1024 * 1024;
const MAX_READ_BYTES = 2_000_000;
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const PAGE_CHARS = 40_000;
const CACHED_DOCUMENTS = 3;
const DOCUMENT = /\.(pdf|docx|xlsx)$/i;
const INDEX_NOTE = "From the system index, which can miss files it has not indexed yet; set thorough=true to scan every folder.";

const CLOUD = "only in the cloud";

export type ComputerAudit = (entry: Omit<ComputerActivity, "at">) => void;

const bytes = (n: number) => n.toLocaleString("en-US");
const ignored = (path: string) => path.split("/").some((part) => IGNORED_DIRS.has(part));

function pageOf(text: string, offset: number): string {
  if (offset > 0 && offset >= text.length) throw new ToolError(`offset ${offset} is past the end: the file has ${bytes(text.length)} characters`);
  const end = Math.min(text.length, offset + PAGE_CHARS);
  if (offset === 0 && end === text.length) return text;
  const more = end < text.length ? `; call again with offset=${end} for the rest` : "; end of file";
  return `${text.slice(offset, end)}\n\n[characters ${bytes(offset)}-${bytes(end)} of ${bytes(text.length)}${more}]`;
}

function detailOf(name: string, args: ToolArgs): string {
  const path = typeof args.path === "string" ? args.path : "";
  const where = path ? ` in ${path}` : "";
  if (name === "RequestComputerAccess") return String(args.reason ?? "");
  if (name === "ListComputerFolder") return path || "(the granted folders)";
  if (name === "SearchComputer" || name === "SearchComputerText") return `"${String(args.query ?? "")}"${where}`;
  const offset = typeof args.offset === "number" && args.offset > 0 ? ` (from character ${args.offset})` : "";
  return `${path}${offset}`;
}

export function computerTools(computer: ComputerPort, audit?: ComputerAudit): ToolRegistry {
  const documents = new Map<string, string>();

  async function targetsOf(args: ToolArgs): Promise<{ wanted: string; targets: string[] }> {
    const wanted = optionalText(args, "path", "").trim();
    const targets = wanted ? [wanted] : (await computer.grants()).map((grant) => grant.label);
    return { wanted, targets };
  }

  async function requestAccess(args: ToolArgs): Promise<string> {
    const reason = text(args, "reason").trim().slice(0, 300);
    if (!reason) throw new ToolError("'reason' is required: say what you are looking for");
    const granted = await computer.choose(reason);
    if (!granted) {
      return "The user did not allow it, so you have no access. Carry on without it, and do not ask again unless they ask you to.";
    }
    if (granted.home) {
      return (
        `Read-only access granted to the user's whole folder, '${granted.label}' (Desktop, Documents, Downloads, OneDrive...). ` +
        `Start with SearchComputer, which with no path searches everything; paths look like '${granted.label}/Documents/...'.`
      );
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
    const lines = entries.map((e) => (e.isDirectory ? `${e.name}/` : `${e.name}  (${bytes(e.size)} bytes${e.cloudOnly ? `, ${CLOUD}` : ""})`));
    return lines.join("\n") || "(empty folder)";
  }

  async function search(args: ToolArgs, signal?: AbortSignal): Promise<string> {
    const query = text(args, "query");
    const terms = termsOf(query);
    if (terms.length === 0) return "Give something to search for -- a filename, a word from one, or a folder name.";

    const thorough = flag(args, "thorough");
    const { wanted, targets } = await targetsOf(args);
    if (targets.length === 0) return "No folder has been granted yet. Ask the user with RequestComputerAccess.";

    const hits = new Map<string, { nameHits: number; path: string; isDirectory: boolean; cloudOnly: boolean }>();
    const add = (path: string, isDirectory: boolean, cloudOnly = false) => {
      if (hits.has(path)) return;
      const name = foldText(path.split("/").pop()!);
      hits.set(path, { nameHits: terms.filter((t) => name.includes(t)).length, path, isDirectory, cloudOnly });
    };
    let scanned = 0;
    let cut = false;
    let viaIndex = false;
    for (const target of targets) {
      let inTarget = 0;
      let asked = false;
      for await (const entry of computer.walk(target, (name) => !IGNORED_DIRS.has(name), signal)) {
        signal?.throwIfAborted();
        scanned += 1;
        inTarget += 1;
        if (scanned > MAX_SCANNED) {
          cut = true;
          break;
        }
        if (hasAllTerms(entry.path, terms)) add(entry.path, entry.isDirectory, entry.cloudOnly);
        if (thorough || asked || inTarget <= SMALL_FOLDER_ENTRIES) continue;
        asked = true;
        const indexed = await computer.indexed(target, rawTermsOf(query), "name", signal);
        if (!indexed?.length) continue;
        viaIndex = true;
        for (const hit of indexed) if (!ignored(hit.path)) add(hit.path, hit.isDirectory, hit.cloudOnly);
        break;
      }
      if (cut) break;
    }

    const notes = [
      cut ? `Stopped after ${bytes(MAX_SCANNED)} entries; narrow it with 'path'.` : "",
      viaIndex ? INDEX_NOTE : "",
    ].filter(Boolean);
    if (hits.size === 0) {
      return [`Nothing matches all of [${terms.join(", ")}] in ${wanted || "the granted folders"} (searched ${bytes(scanned)} entries).`, ...notes].join(" ");
    }
    const ranked = [...hits.values()].sort((a, b) => b.nameHits - a.nameHits || a.path.length - b.path.length || a.path.localeCompare(b.path));
    const lines = ranked.slice(0, SEARCH_LIMIT).map((h) => (h.isDirectory ? `${h.path}/` : h.cloudOnly ? `${h.path}  (${CLOUD})` : h.path));
    if (ranked.length > SEARCH_LIMIT) lines.push(`... and ${ranked.length - SEARCH_LIMIT} more; narrow the query or set 'path'`);
    return [...lines, ...notes].join("\n");
  }

  async function searchText(args: ToolArgs, signal?: AbortSignal): Promise<string> {
    const query = text(args, "query");
    const terms = termsOf(query);
    if (terms.length === 0) return "Give some words to look for inside the files.";

    const thorough = flag(args, "thorough");
    const { wanted, targets } = await targetsOf(args);
    if (targets.length === 0) return "No folder has been granted yet. Ask the user with RequestComputerAccess.";

    type Found = { path: string; size: number; cloudOnly?: boolean; line?: { line: number; text: string } | null };
    const found = new Map<string, Found>();
    const addFound = (hit: Found) => {
      const known = found.get(hit.path);
      if (!known) found.set(hit.path, hit);
      else if (hit.line && !known.line) known.line = hit.line;
    };
    let scanned = 0;
    let skippedCloud = 0;
    let readBytes = 0;
    let cut = false;
    let viaIndex = false;
    for (const target of targets) {
      let trusted = false;
      if (!thorough) {
        const indexed = await computer.indexed(target, rawTermsOf(query), "content", signal);
        if (indexed?.length) {
          viaIndex = true;
          trusted = true;
          for (const entry of indexed) {
            if (!entry.isDirectory && !ignored(entry.path)) addFound({ path: entry.path, size: entry.size, cloudOnly: entry.cloudOnly });
          }
        }
      }
      let inTarget = 0;
      let bytesInTarget = 0;
      for await (const entry of computer.walk(target, (name) => !IGNORED_DIRS.has(name), signal)) {
        signal?.throwIfAborted();
        scanned += 1;
        inTarget += 1;
        if (scanned > MAX_SCANNED) {
          cut = true;
          break;
        }
        if (trusted && (inTarget > SMALL_FOLDER_ENTRIES || bytesInTarget > SMALL_FOLDER_BYTES)) break;
        if (entry.isDirectory || !TEXT_FILE.test(entry.path) || entry.size > MAX_READ_BYTES) continue;
        if (entry.cloudOnly) {
          skippedCloud += 1;
          continue;
        }
        if (readBytes + entry.size > MAX_SCAN_BYTES) {
          cut = true;
          break;
        }
        readBytes += entry.size;
        bytesInTarget += entry.size;
        let content: string;
        try {
          content = decodeText(await computer.readBytes(entry.path), entry.path);
        } catch {
          continue;
        }
        if (hasAllTerms(content, terms)) addFound({ path: entry.path, size: entry.size, line: snippetOf(content, terms) });
      }
      if (cut) break;
    }

    const all = [...found.values()];
    const shown = all.slice(0, TEXT_SEARCH_LIMIT);
    for (const hit of shown) {
      if (hit.line !== undefined || hit.cloudOnly || !TEXT_FILE.test(hit.path) || hit.size > MAX_READ_BYTES) continue;
      signal?.throwIfAborted();
      try {
        hit.line = snippetOf(decodeText(await computer.readBytes(hit.path), hit.path), terms);
      } catch {
        hit.line = null;
      }
    }

    const notes = [
      cut ? `Stopped after ${bytes(scanned)} entries or ${bytes(MAX_SCAN_BYTES)} bytes read; narrow it with 'path'.` : "",
      viaIndex ? INDEX_NOTE : "",
      skippedCloud ? `${skippedCloud} text file(s) stored ${CLOUD} were not opened, because opening them would download them.` : "",
      "Only text files are read when scanning; PDF, Word and Excel are found through the index when it has them, and opened with ReadComputerFile.",
    ].filter(Boolean);
    if (all.length === 0) {
      return [`No file contains all of [${terms.join(", ")}] in ${wanted || "the granted folders"} (read ${bytes(scanned)} entries).`, ...notes].join(" ");
    }
    const lines = shown.map((hit) => {
      if (hit.line) return `${hit.path}:${hit.line.line}: ${hit.line.text}`;
      if (hit.cloudOnly) return `${hit.path}  (${CLOUD})`;
      return DOCUMENT.test(hit.path) ? `${hit.path}  (document)` : hit.path;
    });
    if (all.length > TEXT_SEARCH_LIMIT) lines.push(`... and ${all.length - TEXT_SEARCH_LIMIT} more files; add words or set 'path'`);
    return [...lines, ...notes].join("\n");
  }

  async function read(args: ToolArgs): Promise<string> {
    const path = text(args, "path").trim();
    const info = await computer.stat(path);
    if (!info.exists) throw new ToolError(`File does not exist: ${path}`);
    if (info.isDirectory) throw new ToolError(`'${path}' is a folder, not a file. Use ListComputerFolder`);
    if (info.cloudOnly) throw new ToolError(cloudOnlyMessage(path));
    const offset = args.offset === undefined || args.offset === null ? 0 : args.offset;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) throw new ToolError("'offset' must be a whole number, 0 or more");

    if (DOCUMENT.test(path)) {
      if (info.size > MAX_DOCUMENT_BYTES) {
        throw new ToolError(`'${path}' is ${bytes(info.size)} bytes, over the ${bytes(MAX_DOCUMENT_BYTES)} that can be read.`);
      }
      const key = `${path}|${info.size}`;
      let content = documents.get(key);
      if (content === undefined) {
        content = await computer.document(path);
        documents.set(key, content);
        if (documents.size > CACHED_DOCUMENTS) documents.delete(documents.keys().next().value!);
      }
      if (!content.trim()) {
        throw new ToolError(`'${path}' has no text to read: it is probably scanned images, which cannot be read yet.`);
      }
      return pageOf(content, offset);
    }

    if (info.size > MAX_READ_BYTES) {
      throw new ToolError(`'${path}' is ${bytes(info.size)} bytes, over the ${bytes(MAX_READ_BYTES)} that can be read at once.`);
    }
    return pageOf(decodeText(await computer.readBytes(path), path), offset);
  }

  const audited = (name: string, run: (args: ToolArgs, signal?: AbortSignal) => Promise<string>) => async (args: ToolArgs, signal?: AbortSignal) => {
    try {
      const output = await run(args, signal);
      audit?.({ tool: name, detail: detailOf(name, args), ok: true });
      return output;
    } catch (error) {
      const note = signal?.aborted ? "stopped by the user" : error instanceof Error ? error.message : String(error);
      audit?.({ tool: name, detail: detailOf(name, args), ok: false, note });
      throw error;
    }
  };

  return {
    RequestComputerAccess: { run: audited("RequestComputerAccess", requestAccess), preview: async (args) => `Motivo: ${optionalText(args, "reason", "")}` },
    ListComputerFolder: { run: audited("ListComputerFolder", listFolder) },
    SearchComputer: { run: audited("SearchComputer", search) },
    SearchComputerText: { run: audited("SearchComputerText", searchText) },
    ReadComputerFile: { run: audited("ReadComputerFile", read) },
  };
}
