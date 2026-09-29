/** A project's flat folder and file lists (GET /projects/{id}/tree), as the panel walks them. */

import type { RemoteFile, RemoteFolder, RemoteTree } from "../tools/ports";

export type RemoteEntry =
  | { kind: "folder"; id: string; name: string; path: string; folder: RemoteFolder }
  | { kind: "file"; id: string; name: string; path: string; file: RemoteFile };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es", { sensitivity: "base" });

export class ProjectTree {
  private readonly paths = new Map<string, string>();

  constructor(private readonly tree: RemoteTree) {}

  /** A folder's direct children ("null" is the project root): folders first, then files. */
  children(parentId: string | null): RemoteEntry[] {
    const folders = this.tree.folders.filter((f) => f.parentId === parentId).sort(byName);
    const files = this.tree.files.filter((f) => f.folderId === parentId).sort(byName);
    return [
      ...folders.map((folder): RemoteEntry => ({ kind: "folder", id: folder.id, name: folder.name, path: this.folderPath(folder.id), folder })),
      ...files.map((file): RemoteEntry => ({ kind: "file", id: file.id, name: file.name, path: this.join(file.folderId, file.name), file })),
    ];
  }

  get isEmpty(): boolean {
    return !this.tree.folders.length && !this.tree.files.length;
  }

  /** "a/b/c" for a folder, the way the transfer functions address it. */
  folderPath(folderId: string): string {
    const cached = this.paths.get(folderId);
    if (cached !== undefined) return cached;
    const folder = this.tree.folders.find((f) => f.id === folderId);
    if (!folder) return "";
    const path = this.join(folder.parentId, folder.name);
    this.paths.set(folderId, path);
    return path;
  }

  private join(parentId: string | null, name: string): string {
    const parent = parentId ? this.folderPath(parentId) : "";
    return parent ? `${parent}/${name}` : name;
  }
}
