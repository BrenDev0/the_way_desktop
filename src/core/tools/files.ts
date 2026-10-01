/**
 * The local file tools, ported from the command-line assistant's files/tools.py. The rules
 * are the same ones it learned the hard way; the comments say why each one exists.
 */

import {
  flag,
  optionalText,
  text,
  ToolError,
  type ToolArgs,
  type ToolRegistry,
} from "./contract";
import type { FileSystemPort } from "./ports";
import { decodeText, encodeText } from "./text";

export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  ".venv", "venv", "env", "node_modules", "__pycache__", ".git",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", "dist", "build",
  ".idea", ".vscode", ".next", "target",
]);

const SEARCH_LIMIT = 50;

// A single file can hold hundreds of hits, so the budget is spent per file as well as
// overall -- otherwise one lockfile fills the answer and the other matching files are
// never seen. Long lines are cut because a minified file is one line thousands wide.
const CODE_MATCH_LIMIT = 100;
const PER_FILE_LIMIT = 10;
const MAX_LINE = 200;
// A hit inside a 500 KB lockfile or a vendored bundle is noise every time.
const MAX_SEARCH_BYTES = 2_000_000;

const shown = (path: string) => path || ".";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const bytes = (n: number) => n.toLocaleString("en-US");

export function fileTools(fs: FileSystemPort): ToolRegistry {
  async function readText(path: string): Promise<string> {
    return decodeText(await fs.readBytes(path), shown(path));
  }

  async function readFile(args: ToolArgs): Promise<string> {
    const path = fs.normalize(text(args, "file_path"));
    const info = await fs.stat(path);
    if (!info.exists) throw new ToolError(`File does not exist: ${shown(path)}`);

    // Reading a folder is a common first guess; answering with its contents turns the
    // mistake into the next step instead of a dead end.
    if (info.isDirectory) {
      const entries = (await fs.list(path)).map((e) => e.name + (e.isDirectory ? "/" : ""));
      throw new ToolError(
        `'${shown(path)}' is a directory, not a file. It contains: ` +
          `${entries.sort().join(", ") || "(empty)"}. Read one of those instead.`,
      );
    }
    return readText(path);
  }

  async function listDir(args: ToolArgs): Promise<string> {
    const path = fs.normalize(optionalText(args, "dir_path", "."));
    const info = await fs.stat(path);
    if (!info.exists) throw new ToolError(`Directory does not exist: ${shown(path)}`);
    if (!info.isDirectory) throw new ToolError(`'${shown(path)}' is a file, not a directory. Use ReadFile`);

    const entries = [...(await fs.list(path))].sort(
      (a, b) => Number(!a.isDirectory) - Number(!b.isDirectory) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
    const lines = entries.map((e) => (e.isDirectory ? `${e.name}/` : `${e.name}  (${bytes(e.size)} bytes)`));
    return lines.join("\n") || "(empty directory)";
  }

  async function searchFile(args: ToolArgs): Promise<string> {
    const query = text(args, "file_name");
    const base = fs.normalize(optionalText(args, "base_dir", "."));
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (terms.length === 0) {
      return "Give something to search for -- a filename, a word from one, or a folder name.";
    }

    // Matched against the whole path, not just the name, so 'progreso report' finds
    // tasks/progreso-q3/report.md -- the words can live in different segments.
    const hits: { nameHits: number; path: string; isDirectory: boolean }[] = [];
    let scanned = 0;
    for await (const entry of fs.walk(base, (name) => !IGNORED_DIRS.has(name))) {
      scanned += 1;
      const haystack = entry.path.toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) continue;
      const name = entry.path.split("/").pop()!.toLowerCase();
      hits.push({ nameHits: terms.filter((t) => name.includes(t)).length, path: entry.path, isDirectory: entry.isDirectory });
    }

    if (hits.length === 0) {
      return (
        `Nothing under '${shown(base)}' matches all of [${terms.join(", ")}]. Searched ` +
        `${scanned} entries, skipping ${[...IGNORED_DIRS].sort().join(", ")}. ` +
        "Try fewer or different words, or list a folder with ListDir."
      );
    }

    // a hit on the file name itself beats one that only matched a parent folder
    hits.sort((a, b) => b.nameHits - a.nameHits || a.path.length - b.path.length || a.path.localeCompare(b.path));
    const lines = hits.slice(0, SEARCH_LIMIT).map((h) => (h.isDirectory ? `${h.path}/` : h.path));
    if (hits.length > SEARCH_LIMIT) {
      lines.push(`... and ${hits.length - SEARCH_LIMIT} more; narrow the query or set base_dir`);
    }
    return lines.join("\n");
  }

  async function searchCode(args: ToolArgs): Promise<string> {
    const pattern = text(args, "pattern");
    const base = fs.normalize(optionalText(args, "base_dir", "."));
    const glob = args.file_glob == null ? null : text(args, "file_glob");
    const filesOnly = flag(args, "files_only");

    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern, flag(args, "case_sensitive") ? "" : "i");
    } catch (error) {
      return (
        `'${pattern}' is not a valid regular expression (${(error as Error).message}). Escape ` +
        "the regex characters . * + ? [ ] ( ) | \\ to search for them literally."
      );
    }
    const globMatcher = glob ? globToRegExp(glob) : null;

    const root = await fs.stat(base);
    const candidates: { path: string; size: number }[] = [];
    if (root.exists && !root.isDirectory) {
      candidates.push({ path: base, size: root.size });
    } else {
      for await (const entry of fs.walk(base, (name) => !IGNORED_DIRS.has(name))) {
        if (!entry.isDirectory) candidates.push(entry);
      }
    }

    // Counting goes on after the output budget is spent, so the summary can say how much
    // was left out -- a silent cut would let the model think it saw every occurrence of a
    // name it is about to rename.
    const lines: string[] = [];
    let total = 0;
    let filesHit = 0;
    let scanned = 0;
    let unreadable = 0;

    for (const file of candidates) {
      if (globMatcher && !globMatcher.test(file.path.split("/").pop()!)) continue;
      if (file.size > MAX_SEARCH_BYTES) continue;

      let content: string;
      try {
        content = await readText(file.path);
      } catch {
        unreadable += 1;
        continue;
      }

      scanned += 1;
      const hits = content
        .split("\n")
        .map((line, index) => ({ number: index + 1, line }))
        .filter(({ line }) => matcher.test(line));
      if (hits.length === 0) continue;

      filesHit += 1;
      total += hits.length;

      if (filesOnly) {
        if (lines.length < CODE_MATCH_LIMIT) lines.push(`${file.path}  (${plural(hits.length, "line")})`);
        continue;
      }

      for (const { number, line } of hits.slice(0, PER_FILE_LIMIT)) {
        if (lines.length >= CODE_MATCH_LIMIT) break;
        const body = line.trim();
        lines.push(`${file.path}:${number}: ${body.length > MAX_LINE ? `${body.slice(0, MAX_LINE)} ...` : body}`);
      }
      if (hits.length > PER_FILE_LIMIT && lines.length < CODE_MATCH_LIMIT) {
        lines.push(`${file.path}: ... and ${hits.length - PER_FILE_LIMIT} more in this file`);
      }
    }

    if (filesHit === 0) {
      return (
        `No file${glob ? ` matching ${glob}` : ""} under '${shown(base)}' contains '${pattern}'. ` +
        `Searched ${scanned} files, skipping ${[...IGNORED_DIRS].sort().join(", ")}. ` +
        "Try a shorter or less exact pattern, or widen base_dir."
      );
    }

    // lines, not occurrences -- said plainly because a rename gets sized against it
    let summary = `${plural(total, "matching line")} in ${plural(filesHit, "file")} (searched ${scanned})`;
    if (unreadable) summary += `, ${unreadable} binary or unreadable file(s) skipped`;
    if (!filesOnly && lines.length >= CODE_MATCH_LIMIT) {
      summary += " -- output stopped at the limit, narrow base_dir or file_glob to see the rest";
    }
    return [...lines, "", summary].join("\n");
  }

  async function createDir(args: ToolArgs): Promise<string> {
    const path = fs.normalize(text(args, "dir_path"));
    await fs.makeDirectory(path);
    return shown(path);
  }

  async function createFile(args: ToolArgs): Promise<string> {
    const path = fs.normalize(text(args, "file_path"));
    const info = await fs.stat(path);
    if (info.isDirectory) throw new ToolError(`'${shown(path)}' is a directory`);
    if (info.exists && !flag(args, "overwrite")) {
      throw new ToolError(`File already exists: ${shown(path)}. Pass overwrite=true to replace it`);
    }
    await fs.writeBytes(path, encodeText(optionalText(args, "content", "")));
    return shown(path);
  }

  /** The file after the edit, without writing it -- for the approval to show a proposal. */
  async function edited(args: ToolArgs): Promise<{ path: string; before: string; after: string }> {
    const path = fs.normalize(text(args, "file_path"));
    const oldString = text(args, "old_string");
    const newString = text(args, "new_string");
    const replaceAll = flag(args, "replace_all");

    const info = await fs.stat(path);
    if (!info.exists) throw new ToolError(`File does not exist: ${shown(path)}`);
    if (info.isDirectory) throw new ToolError(`'${shown(path)}' is a directory, not a file`);

    const before = await readText(path);
    const occurrences = oldString ? before.split(oldString).length - 1 : 0;
    if (occurrences === 0) throw new ToolError(`old_string not found in ${shown(path)}`);
    if (occurrences > 1 && !replaceAll) {
      throw new ToolError(
        `old_string is not unique in ${shown(path)} (${occurrences} matches). ` +
          "Pass replace_all=true or make old_string more specific",
      );
    }

    const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, () => newString);
    return { path, before, after };
  }

  async function updateFile(args: ToolArgs): Promise<string> {
    const { path, after } = await edited(args);
    await fs.writeBytes(path, encodeText(after));
    return shown(path);
  }

  /** Where a copy or move really lands, with the conventions of cp and mv. */
  async function destination(source: string, target: string, overwrite: boolean): Promise<string> {
    const sourceInfo = await fs.stat(source);
    let resolved = fs.normalize(target);
    const targetInfo = await fs.stat(resolved);

    // a file named against an existing folder lands inside it, not over it
    if (targetInfo.isDirectory && !sourceInfo.isDirectory) {
      resolved = fs.normalize(`${resolved}/${source.split("/").pop()}`);
    }
    const finalInfo = await fs.stat(resolved);
    if (finalInfo.exists && !overwrite) {
      throw new ToolError(`'${shown(resolved)}' already exists. Pass overwrite=true to replace it.`);
    }
    if (sourceInfo.isDirectory && (resolved === source || resolved.startsWith(`${source}/`))) {
      throw new ToolError(`Cannot copy or move '${shown(source)}' into itself ('${shown(resolved)}').`);
    }
    if (finalInfo.exists) await fs.remove(resolved, true);
    return resolved;
  }

  async function copyPath(args: ToolArgs): Promise<string> {
    const source = fs.normalize(text(args, "source"));
    const info = await fs.stat(source);
    if (!info.exists) throw new ToolError(`Nothing to copy at: ${shown(source)}`);

    const target = await destination(source, text(args, "destination"), flag(args, "overwrite"));
    await fs.copy(source, target);
    if (info.isDirectory) return `Copied ${await countFiles(target)} file(s) from ${shown(source)}/ to ${shown(target)}/`;
    return `Copied ${shown(source)} to ${shown(target)} (${bytes(info.size)} bytes)`;
  }

  async function movePath(args: ToolArgs): Promise<string> {
    const source = fs.normalize(text(args, "source"));
    const info = await fs.stat(source);
    if (!info.exists) throw new ToolError(`Nothing to move at: ${shown(source)}`);
    if (source === "") throw new ToolError("Refusing to move the open folder itself");

    const target = await destination(source, text(args, "destination"), flag(args, "overwrite"));
    await fs.move(source, target);
    if (info.isDirectory) return `Moved ${await countFiles(target)} file(s) from ${shown(source)}/ to ${shown(target)}/`;
    return `Moved ${shown(source)} to ${shown(target)} (${bytes(info.size)} bytes)`;
  }

  async function renamePath(args: ToolArgs): Promise<string> {
    const source = fs.normalize(text(args, "path"));
    const name = text(args, "new_name").trim();
    if (!name || name === "." || name === ".." || /[\\/<>:"|?*]/.test(name)) {
      throw new ToolError("new_name must be a plain name, not a path. To move it elsewhere, use MovePath.");
    }
    if (source === "") throw new ToolError("Refusing to rename the open folder itself");
    const info = await fs.stat(source);
    if (!info.exists) throw new ToolError(`Nothing to rename at: ${shown(source)}`);

    const target = fs.normalize([...source.split("/").slice(0, -1), name].join("/"));
    if (target === source) return `${shown(source)} already has that name`;
    // a case-only rename finds the source itself there on Windows, which is fine
    if ((await fs.stat(target)).exists && target.toLowerCase() !== source.toLowerCase()) {
      throw new ToolError(`'${shown(target)}' already exists. Pick another name or ask the user.`);
    }
    await fs.move(source, target);
    return `Renamed ${shown(source)} to ${shown(target)}`;
  }

  async function deleteFile(args: ToolArgs): Promise<string> {
    const path = fs.normalize(text(args, "file_path"));
    const info = await fs.stat(path);
    if (!info.exists) throw new ToolError(`File does not exist: ${shown(path)}`);
    if (info.isDirectory) throw new ToolError(`'${shown(path)}' is a directory, not a file. Use DeleteDir instead`);
    await fs.remove(path, false);
    return shown(path);
  }

  async function deleteDir(args: ToolArgs): Promise<string> {
    const path = fs.normalize(text(args, "dir_path"));
    const info = await fs.stat(path);
    if (!info.exists) throw new ToolError(`Directory does not exist: ${shown(path)}`);
    if (!info.isDirectory) throw new ToolError(`'${shown(path)}' is not a directory. Use DeleteFile instead`);
    if (path === "") throw new ToolError("Refusing to delete the open folder itself");

    const recursive = flag(args, "recursive");
    if (!recursive && (await fs.list(path)).length > 0) {
      throw new ToolError(`Directory not empty: ${shown(path)}. Pass recursive=true to delete it and its contents`);
    }
    await fs.remove(path, true);
    return shown(path);
  }

  async function countFiles(path: string): Promise<number> {
    let files = 0;
    for await (const entry of fs.walk(path, () => true)) if (!entry.isDirectory) files += 1;
    return files;
  }

  return {
    ReadFile: { run: readFile },
    ListDir: { run: listDir },
    SearchFile: { run: searchFile },
    SearchCode: { run: searchCode },
    CreateDir: { run: createDir },
    CreateFile: { run: createFile },
    UpdateFile: {
      run: updateFile,
      preview: async (args) => {
        const { path, before, after } = await edited(args);
        return diff(shown(path), before, after);
      },
    },
    CopyPath: { run: copyPath },
    MovePath: { run: movePath },
    RenamePath: { run: renamePath },
    DeleteFile: { run: deleteFile },
    DeleteDir: { run: deleteDir },
  };
}

/** '*.py', 'test_*.ts' -- the name-only globs file_glob takes. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * A compact line diff for the approval dialog: the changed region with a few lines of
 * context. Not a general diff -- one edit replaces one region, which is all it needs.
 */
export function diff(path: string, before: string, after: string, context = 3): string {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }

  const from = Math.max(0, start - context);
  const lines = [`--- ${path}`, `+++ ${path}`, `@@ line ${from + 1} @@`];
  for (let i = from; i < start; i += 1) lines.push(`  ${a[i]}`);
  for (let i = start; i <= endA; i += 1) lines.push(`- ${a[i]}`);
  for (let i = start; i <= endB; i += 1) lines.push(`+ ${b[i]}`);
  for (let i = endA + 1; i < Math.min(a.length, endA + 1 + context); i += 1) lines.push(`  ${a[i]}`);
  return lines.join("\n");
}
