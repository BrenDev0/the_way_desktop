/**
 * The files panel's operations on the open folder. The same FileSystemPort the agent's
 * tools use, so the same sandbox applies; the difference is who asks and in what words.
 * Messages here are for the operator, in Spanish.
 */

import type { FileSystemPort } from "../tools/ports";

export interface LocalEntry {
  /** Relative to the open folder, "/"-separated. */
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
}

export class LocalFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalFilesError";
  }
}

const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Why a name cannot be used, or null. The rules are the server's project-name rules
 * (src/projects/use_cases.py validate_name), so anything made here can be uploaded later.
 */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Escribe un nombre.";
  if (trimmed.length > 255) return "El nombre no puede superar los 255 caracteres.";
  if (trimmed === "." || trimmed === ".." || trimmed.endsWith(".")) return "El nombre no puede terminar en punto.";
  if (FORBIDDEN.test(trimmed)) return 'El nombre no puede contener < > : " / \\ | ? *';
  if (RESERVED.test(trimmed.split(".")[0])) return `"${trimmed}" es un nombre reservado de Windows.`;
  return null;
}

function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function join(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

export class LocalFiles {
  constructor(private readonly fs: FileSystemPort) {}

  /** One folder's entries: folders first, then files, each alphabetical. */
  async list(folder: string): Promise<LocalEntry[]> {
    const base = this.fs.normalize(folder);
    const info = await this.fs.stat(base);
    if (!info.exists || !info.isDirectory) throw new LocalFilesError("Esa carpeta ya no existe.");
    const entries = await this.fs.list(base);
    return entries
      .map((entry) => ({ path: join(base, entry.name), name: entry.name, isDirectory: entry.isDirectory, size: entry.size }))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }

  async createFolder(parent: string, name: string): Promise<string> {
    const target = join(this.fs.normalize(parent), this.checkName(name));
    await this.refuseExisting(target);
    await this.fs.makeDirectory(target);
    return target;
  }

  async rename(path: string, name: string): Promise<string> {
    const source = await this.existing(path);
    const target = join(parentOf(source), this.checkName(name));
    if (target === source) return source;
    // Windows sees "Notas.md" and "notas.md" as the same file, so a change of case is not a clash.
    if (target.toLowerCase() !== source.toLowerCase()) await this.refuseExisting(target);
    await this.fs.move(source, target);
    return target;
  }

  /** Moves a file or folder into another folder, keeping its name. */
  async move(path: string, folder: string): Promise<string> {
    const source = await this.existing(path);
    const destination = this.fs.normalize(folder);
    const info = await this.fs.stat(destination);
    if (!info.exists || !info.isDirectory) throw new LocalFilesError("La carpeta de destino ya no existe.");
    if (destination === source || destination.startsWith(`${source}/`)) {
      throw new LocalFilesError("No puedes mover una carpeta dentro de sí misma.");
    }
    const target = join(destination, source.split("/").pop()!);
    if (target === source) return source;
    await this.refuseExisting(target);
    await this.fs.move(source, target);
    return target;
  }

  /** Deletes a file, or a folder with everything in it. The panel asks first. */
  async remove(path: string): Promise<void> {
    const target = await this.existing(path);
    const info = await this.fs.stat(target);
    await this.fs.remove(target, info.isDirectory);
  }

  private checkName(name: string): string {
    const problem = nameProblem(name);
    if (problem) throw new LocalFilesError(problem);
    return name.trim();
  }

  private async existing(path: string): Promise<string> {
    const normalized = this.fs.normalize(path);
    if (!normalized) throw new LocalFilesError("La carpeta de trabajo no se puede renombrar, mover ni eliminar desde aquí.");
    if (!(await this.fs.stat(normalized)).exists) throw new LocalFilesError("Ese archivo ya no existe. Actualiza la lista.");
    return normalized;
  }

  // fs.move uses rename, which replaces an existing file without asking.
  private async refuseExisting(target: string): Promise<void> {
    if ((await this.fs.stat(target)).exists) {
      throw new LocalFilesError(`Ya existe "${target.split("/").pop()}" en esa carpeta.`);
    }
  }
}
