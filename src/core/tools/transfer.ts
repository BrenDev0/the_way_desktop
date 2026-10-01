/**
 * Carrying files between the user's computer and their projects on the server -- the
 * replacement for the command-line assistant's bucket upload and download tools.
 */

import { flag, optionalText, text, ToolError, type ToolArgs, type ToolRegistry } from "./contract";
import { IGNORED_DIRS } from "./files";
import type { FileSystemPort, ProjectRef, ProjectsApiPort, RemoteFile, RemoteFolder, RemoteTree } from "./ports";

// Pointing an upload at the wrong folder is refused rather than billed.
export const MAX_UPLOAD_FILES = 500;
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

const TYPES: Record<string, string> = {
  md: "text/markdown", txt: "text/plain", html: "text/html", htm: "text/html", css: "text/css",
  js: "text/javascript", ts: "text/plain", json: "application/json", csv: "text/csv",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", pdf: "application/pdf", zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function contentTypeFor(name: string): string {
  const suffix = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return TYPES[suffix] ?? "application/octet-stream";
}

function segments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
}

/** The folder tree of one project, walkable by name the way paths are written. */
class Remote {
  constructor(
    private readonly api: ProjectsApiPort,
    readonly project: ProjectRef,
    private readonly tree: RemoteTree,
  ) {}

  static async open(api: ProjectsApiPort, name: string): Promise<Remote> {
    const projects = await api.projects();
    const project = projects.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (!project) {
      throw new ToolError(
        `No project named '${name}'. The user's projects: ${projects.map((p) => p.name).join(", ") || "none yet"}.`,
      );
    }
    return new Remote(api, project, await api.tree(project.id));
  }

  child(parentId: string | null, name: string): RemoteFolder | RemoteFile | undefined {
    const wanted = name.toLowerCase();
    return (
      this.tree.folders.find((f) => f.parentId === parentId && f.name.toLowerCase() === wanted) ??
      this.tree.files.find((f) => f.folderId === parentId && f.name.toLowerCase() === wanted)
    );
  }

  resolve(path: string): RemoteFolder | RemoteFile | null {
    let current: RemoteFolder | RemoteFile | null = null;
    for (const part of segments(path)) {
      if (current && !isFolder(current)) throw new ToolError(`'${current.name}' is a file, not a folder`);
      const next = this.child(current?.id ?? null, part);
      if (!next) throw new ToolError(`Nothing named '${path}' in ${this.project.name}`);
      current = next;
    }
    return current;
  }

  /** mkdir -p inside the project. */
  async ensureFolder(parts: string[], from: string | null = null): Promise<string | null> {
    let parentId = from;
    for (const part of parts) {
      const existing = this.child(parentId, part);
      if (existing && !isFolder(existing)) throw new ToolError(`'${part}' in ${this.project.name} is a file, not a folder`);
      const folder = existing ?? (await this.api.createFolder(this.project.id, part, parentId));
      if (!existing) this.tree.folders.push(folder as RemoteFolder);
      parentId = folder.id;
    }
    return parentId;
  }

  folders(parentId: string | null): RemoteFolder[] {
    return this.tree.folders.filter((f) => f.parentId === parentId);
  }

  files(folderId: string | null): RemoteFile[] {
    return this.tree.files.filter((f) => f.folderId === folderId);
  }
}

function isFolder(entry: RemoteFolder | RemoteFile): entry is RemoteFolder {
  return "parentId" in entry;
}

/** A file in a project, by the names a person (or the agent's report) would use. */
export async function findProjectFile(
  api: ProjectsApiPort,
  projectName: string,
  path: string,
): Promise<{ project: ProjectRef; file: RemoteFile }> {
  const remote = await Remote.open(api, projectName);
  const found = remote.resolve(path);
  if (!found || isFolder(found)) throw new ToolError(`'${path}' in ${remote.project.name} is a folder, not a file`);
  if (found.status !== "ready") throw new ToolError(`'${found.name}' has not finished uploading`);
  return { project: remote.project, file: found };
}

/** An upload over MAX_UPLOAD_FILES or MAX_UPLOAD_BYTES; the message is for the agent. */
export class UploadLimitError extends ToolError {
  constructor(message: string, readonly limit: "files" | "bytes", readonly amount: number) {
    super(message);
    this.name = "UploadLimitError";
  }
}

export interface UploadRequest {
  /** Relative to the open folder: a file, a folder, or "" for the whole folder. */
  localPath: string;
  /** Project name, matched case-insensitively (names are unique per user). */
  project: string;
  /** Folder inside the project, created if missing; "." or "" is its root. */
  destination?: string;
}

export interface UploadResult {
  project: ProjectRef;
  /** "Project/destination" as the user would write it. */
  where: string;
  uploaded: string[];
  /** Already in the project under the same path; never overwritten. */
  skipped: string[];
}

export interface DownloadRequest {
  project: string;
  /** Path inside the project; "" or "." downloads all of it. */
  path: string;
  /** Local folder (or file path) to write into, relative to the open folder. */
  localPath?: string;
  overwrite?: boolean;
}

export interface DownloadResult {
  project: ProjectRef;
  written: string[];
}

async function localFiles(fs: FileSystemPort, root: string): Promise<{ path: string; size: number }[]> {
  const info = await fs.stat(root);
  if (!info.exists) throw new ToolError(`Nothing to upload at: ${root || "."}`);
  if (!info.isDirectory) return [{ path: root, size: info.size }];

  const found: { path: string; size: number }[] = [];
  for await (const entry of fs.walk(root, (name) => !IGNORED_DIRS.has(name))) {
    if (!entry.isDirectory) found.push(entry);
  }
  return found;
}

/** Copies a local file or folder into a project. Used by UploadToProject and the files panel. */
export async function uploadToProject(fs: FileSystemPort, api: ProjectsApiPort, request: UploadRequest): Promise<UploadResult> {
  const localPath = fs.normalize(request.localPath);
  const remote = await Remote.open(api, request.project);
  const destination = segments(request.destination ?? ".");

  const files = await localFiles(fs, localPath);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length > MAX_UPLOAD_FILES) {
    throw new UploadLimitError(`That is ${files.length} files; the limit for one upload is ${MAX_UPLOAD_FILES}. Upload a narrower folder.`, "files", files.length);
  }
  if (total > MAX_UPLOAD_BYTES) {
    throw new UploadLimitError(`That is ${(total / 1048576).toFixed(0)} MB; the limit for one upload is 512 MB.`, "bytes", total);
  }

  // A folder upload keeps its own name, the way copying a folder into a folder does.
  const info = await fs.stat(localPath);
  const base = await remote.ensureFolder(destination);
  const root = info.isDirectory ? localPath : localPath.split("/").slice(0, -1).join("/");
  const wrapper = info.isDirectory && localPath ? [localPath.split("/").pop()!] : [];

  const uploaded: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const relative = root ? file.path.slice(root.length + 1) : file.path;
    const parts = [...wrapper, ...segments(relative)];
    const name = parts.pop()!;
    const folderId = await remote.ensureFolder(parts, base);
    if (remote.child(folderId, name)) {
      skipped.push([...parts, name].join("/"));
      continue;
    }
    await api.upload(remote.project.id, folderId, name, await fs.readBytes(file.path), contentTypeFor(name));
    uploaded.push([...parts, name].join("/"));
  }

  return { project: remote.project, where: `${remote.project.name}/${destination.join("/") || "."}`, uploaded, skipped };
}

/** Copies a project file or folder onto the computer. Used by DownloadFromProject and the files panel. */
export async function downloadFromProject(fs: FileSystemPort, api: ProjectsApiPort, request: DownloadRequest): Promise<DownloadResult> {
  const remote = await Remote.open(api, request.project);
  const target = fs.normalize(request.localPath ?? ".");
  const entry = remote.resolve(request.path);
  const written: string[] = [];

  async function save(file: RemoteFile, localPath: string) {
    if (file.status !== "ready") return;
    const info = await fs.stat(localPath);
    if (info.exists && !request.overwrite) {
      throw new ToolError(`'${localPath}' already exists on the computer. Pass overwrite=true to replace it.`);
    }
    await fs.writeBytes(localPath, await api.download(remote.project.id, file.id));
    written.push(localPath);
  }

  async function saveFolder(folderId: string | null, localPath: string) {
    await fs.makeDirectory(localPath);
    for (const file of remote.files(folderId)) await save(file, join(localPath, file.name));
    for (const folder of remote.folders(folderId)) await saveFolder(folder.id, join(localPath, folder.name));
  }

  if (entry === null) {
    await saveFolder(null, target);
  } else if (isFolder(entry)) {
    await saveFolder(entry.id, join(target, entry.name));
  } else {
    const info = await fs.stat(target);
    await save(entry, info.isDirectory ? join(target, entry.name) : target);
  }
  return { project: remote.project, written };
}

export function transferTools(fs: FileSystemPort, api: ProjectsApiPort): ToolRegistry {
  async function upload(args: ToolArgs): Promise<string> {
    const result = await uploadToProject(fs, api, {
      localPath: text(args, "local_path"),
      project: text(args, "project"),
      destination: optionalText(args, "destination_path", "."),
    });
    const lines = [`Uploaded ${result.uploaded.length} file(s) to ${result.where}.`];
    if (result.skipped.length) {
      lines.push(
        `Skipped ${result.skipped.length} already in the project (nothing was overwritten): ${result.skipped.slice(0, 20).join(", ")}` +
          (result.skipped.length > 20 ? ` and ${result.skipped.length - 20} more` : ""),
      );
    }
    return lines.join("\n");
  }

  async function download(args: ToolArgs): Promise<string> {
    const path = text(args, "path");
    const { project, written } = await downloadFromProject(fs, api, {
      project: text(args, "project"),
      path,
      localPath: optionalText(args, "local_path", "."),
      overwrite: flag(args, "overwrite"),
    });
    return `Downloaded ${written.length} file(s) from ${project.name}/${path}: ${written.slice(0, 20).join(", ")}` +
      (written.length > 20 ? ` and ${written.length - 20} more` : "");
  }

  return {
    UploadToProject: { run: upload },
    DownloadFromProject: { run: download },
  };
}

function join(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}
