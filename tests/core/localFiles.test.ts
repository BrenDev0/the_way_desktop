import { describe, expect, it } from "vitest";
import { LocalFiles, nameProblem } from "../../src/core/workspace/localFiles";
import { MemoryFileSystem } from "../support/memoryFileSystem";

function setup() {
  const fs = new MemoryFileSystem({
    "notas.md": "hola",
    "clientes/acme/brief.md": "brief",
    "clientes/lista.csv": "a,b",
  });
  return { fs, files: new LocalFiles(fs) };
}

describe("LocalFiles", () => {
  it("lists folders first, then files, alphabetically and with paths", async () => {
    const { files } = setup();
    await files.createFolder("", "Zeta");
    expect((await files.list("")).map((e) => [e.name, e.isDirectory])).toEqual([
      ["clientes", true],
      ["Zeta", true],
      ["notas.md", false],
    ]);
    expect((await files.list("clientes")).map((e) => e.path)).toEqual(["clientes/acme", "clientes/lista.csv"]);
  });

  it("creates folders and refuses a name already taken", async () => {
    const { fs, files } = setup();
    expect(await files.createFolder("clientes", " nuevos ")).toBe("clientes/nuevos");
    expect(fs.directories.has("clientes/nuevos")).toBe(true);
    await expect(files.createFolder("clientes", "acme")).rejects.toThrow('Ya existe "acme"');
  });

  it("renames in place and never replaces another entry", async () => {
    const { fs, files } = setup();
    expect(await files.rename("notas.md", "ideas.md")).toBe("ideas.md");
    expect(fs.text("ideas.md")).toBe("hola");
    await expect(files.rename("ideas.md", "clientes")).rejects.toThrow('Ya existe "clientes"');
    expect(fs.files.has("ideas.md")).toBe(true);
  });

  it("allows a rename that only changes capitalisation", async () => {
    const { fs, files } = setup();
    expect(await files.rename("notas.md", "Notas.md")).toBe("Notas.md");
    expect(fs.text("Notas.md")).toBe("hola");
  });

  it("moves into another folder, keeping the name, and refuses clashes and cycles", async () => {
    const { fs, files } = setup();
    expect(await files.move("notas.md", "clientes/acme")).toBe("clientes/acme/notas.md");
    expect(fs.text("clientes/acme/notas.md")).toBe("hola");
    await expect(files.move("clientes", "clientes/acme")).rejects.toThrow("dentro de sí misma");
    await fs.writeBytes("brief.md", new TextEncoder().encode("otro"));
    await expect(files.move("brief.md", "clientes/acme")).rejects.toThrow('Ya existe "brief.md"');
    expect(fs.text("clientes/acme/brief.md")).toBe("brief");
  });

  it("deletes files and whole folders, but never the open folder itself", async () => {
    const { fs, files } = setup();
    await files.remove("clientes");
    expect([...fs.files.keys()]).toEqual(["notas.md"]);
    await expect(files.remove("")).rejects.toThrow("carpeta de trabajo");
    await expect(files.remove("fantasma.txt")).rejects.toThrow("ya no existe");
  });

  it("uses the server's name rules so anything made here can be uploaded", () => {
    expect(nameProblem("informe final.md")).toBeNull();
    expect(nameProblem("   ")).toBe("Escribe un nombre.");
    expect(nameProblem("a/b")).toMatch(/no puede contener/);
    expect(nameProblem("fin.")).toMatch(/punto/);
    expect(nameProblem("CON.txt")).toMatch(/reservado/);
    expect(nameProblem("x".repeat(256))).toMatch(/255/);
  });
});
