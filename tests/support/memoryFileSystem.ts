import type { DirectoryEntry, FileInfo, FileSystemPort, WalkEntry } from "../../src/core/tools/ports";

const encoder = new TextEncoder();

/** A folder held in memory, with the same sandbox rules the real adapter enforces. */
export class MemoryFileSystem implements FileSystemPort {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>([""]);

  constructor(seed: Record<string, string | Uint8Array> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      this.put(path, typeof content === "string" ? encoder.encode(content) : content);
    }
  }

  text(path: string): string {
    return new TextDecoder().decode(this.files.get(path));
  }

  normalize(path: string): string {
    if (/^([a-zA-Z]:|[\\/])/.test(path)) throw new Error(`'${path}' is absolute; paths are relative to the open folder`);
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) throw new Error(`'${path}' resolves outside the open folder`);
        parts.pop();
      } else parts.push(part);
    }
    return parts.join("/");
  }

  async stat(path: string): Promise<FileInfo> {
    if (this.directories.has(path)) return { exists: true, isDirectory: true, size: 0 };
    const file = this.files.get(path);
    return file ? { exists: true, isDirectory: false, size: file.length } : { exists: false, isDirectory: false, size: 0 };
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error(`No such file: ${path}`);
    return file;
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    this.put(path, data);
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    return this.children(path).map((child) => ({
      name: child.split("/").pop()!,
      isDirectory: this.directories.has(child),
      size: this.files.get(child)?.length ?? 0,
    }));
  }

  async *walk(path: string, enter: (name: string) => boolean): AsyncIterable<WalkEntry> {
    for (const child of this.children(path).sort()) {
      const isDirectory = this.directories.has(child);
      if (isDirectory && !enter(child.split("/").pop()!)) continue;
      yield { path: child, isDirectory, size: this.files.get(child)?.length ?? 0 };
      if (isDirectory) yield* this.walk(child, enter);
    }
  }

  async makeDirectory(path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) this.directories.add(parts.slice(0, i).join("/"));
  }

  async copy(source: string, target: string): Promise<void> {
    for (const [path, data] of [...this.files]) {
      if (path === source || path.startsWith(`${source}/`)) this.put(target + path.slice(source.length), data);
    }
    for (const dir of [...this.directories]) {
      if (dir === source || dir.startsWith(`${source}/`)) await this.makeDirectory(target + dir.slice(source.length));
    }
  }

  async move(source: string, target: string): Promise<void> {
    await this.copy(source, target);
    await this.remove(source, true);
  }

  async remove(path: string, recursive: boolean): Promise<void> {
    if (!recursive && this.children(path).length) throw new Error("not empty");
    for (const file of [...this.files.keys()]) if (file === path || file.startsWith(`${path}/`)) this.files.delete(file);
    for (const dir of [...this.directories]) if (dir === path || dir.startsWith(`${path}/`)) this.directories.delete(dir);
  }

  private put(path: string, data: Uint8Array) {
    const parent = path.split("/").slice(0, -1).join("/");
    void this.makeDirectory(parent);
    this.files.set(path, data);
  }

  private children(path: string): string[] {
    const prefix = path ? `${path}/` : "";
    const direct = (candidate: string) => candidate.startsWith(prefix) && candidate !== path && !candidate.slice(prefix.length).includes("/");
    return [...[...this.directories].filter((d) => d && direct(d)), ...[...this.files.keys()].filter(direct)];
  }
}
