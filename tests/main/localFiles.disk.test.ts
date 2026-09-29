import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFiles } from "../../src/core/workspace/localFiles";
import { NodeFileSystem } from "../../src/main/nodeFileSystem";

// The files panel on the real disk: the cases an in-memory folder cannot show.
let base: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "the-way-panel-"));
  root = join(base, "trabajo");
  await mkdir(root);
  await writeFile(join(root, "notas.md"), "mías");
  await writeFile(join(root, "otras.md"), "de otro");
  await writeFile(join(base, "fuera.txt"), "no tocar");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const files = () => new LocalFiles(new NodeFileSystem(async () => root));

describe("LocalFiles on disk", () => {
  it("does not let a rename replace another file, which a plain rename would", async () => {
    await expect(files().rename("notas.md", "otras.md")).rejects.toThrow('Ya existe "otras.md"');
    expect(await readFile(join(root, "otras.md"), "utf8")).toBe("de otro");
    expect(await readFile(join(root, "notas.md"), "utf8")).toBe("mías");
  });

  it("renames by capitalisation only, even on case-insensitive disks", async () => {
    expect(await files().rename("notas.md", "Notas.md")).toBe("Notas.md");
    expect((await readdir(root)).sort()).toEqual(["Notas.md", "otras.md"]);
  });

  it("stays inside the open folder", async () => {
    await expect(files().move("notas.md", "..")).rejects.toThrow(/outside the open folder/);
    await expect(files().remove("../fuera.txt")).rejects.toThrow(/outside the open folder/);
    expect(await readFile(join(base, "fuera.txt"), "utf8")).toBe("no tocar");
  });
});
