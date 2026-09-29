import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BROWSER_TOOLS, FILE_TOOLS, TRANSFER_TOOLS } from "../../src/core/tools/contract";
import { desktopTools } from "../../src/core/tools";
import { fileTools } from "../../src/core/tools/files";
import type { BrowserPort, ProjectsApiPort } from "../../src/core/tools/ports";
import { NodeFileSystem } from "../../src/main/nodeFileSystem";

let base: string;
let root: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "the-way-fs-"));
  root = join(base, "project");
  outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "top secret");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const tools = () => fileTools(new NodeFileSystem(async () => root));

describe("NodeFileSystem", () => {
  it("reads and writes inside the open folder", async () => {
    await tools().CreateFile.run({ file_path: "notes/todo.md", content: "- milk\n" });
    expect(await readFile(join(root, "notes", "todo.md"), "utf8")).toBe("- milk\n");
    expect(await tools().ReadFile.run({ file_path: "notes/todo.md" })).toBe("- milk\n");
  });

  it("refuses to climb out with ..", async () => {
    await expect(tools().ReadFile.run({ file_path: "../outside/secret.txt" })).rejects.toThrow(/outside the open folder/);
  });

  it("refuses an absolute path", async () => {
    await expect(tools().ReadFile.run({ file_path: join(outside, "secret.txt") })).rejects.toThrow(/absolute/);
  });

  it("refuses to follow a symlink that leads outside", async (context) => {
    try {
      await symlink(outside, join(root, "escape"), "junction");
    } catch {
      context.skip(); // creating links needs a privilege this machine may not grant
    }
    await expect(tools().ReadFile.run({ file_path: "escape/secret.txt" })).rejects.toThrow(/outside the open folder/);
    await expect(tools().CreateFile.run({ file_path: "escape/planted.txt", content: "x" })).rejects.toThrow(/outside/);
  });

  it("does not walk into links", async (context) => {
    try {
      await symlink(outside, join(root, "escape"), "junction");
    } catch {
      context.skip();
    }
    expect(await tools().SearchCode.run({ pattern: "top secret" })).toMatch(/^No file/);
  });

  it("says to choose a folder when none is open", async () => {
    const none = fileTools(new NodeFileSystem(async () => null));
    await expect(none.ListDir.run({})).rejects.toThrow(/No folder is open/);
  });

  it("moves across folders and deletes recursively only when asked", async () => {
    await tools().CreateFile.run({ file_path: "a/b/c.txt", content: "x" });
    await tools().MovePath.run({ source: "a", destination: "moved" });
    expect(await readFile(join(root, "moved", "b", "c.txt"), "utf8")).toBe("x");
    await expect(tools().DeleteDir.run({ dir_path: "moved" })).rejects.toThrow(/not empty/);
    await tools().DeleteDir.run({ dir_path: "moved", recursive: true });
    expect(await tools().ListDir.run({})).toBe("(empty directory)");
  });
});

describe("the tool contract", () => {
  it("implements exactly the tools the contract names", () => {
    const registry = desktopTools({
      files: new NodeFileSystem(async () => root),
      browser: {} as BrowserPort,
      projects: {} as ProjectsApiPort,
    });
    expect(Object.keys(registry).sort()).toEqual([...FILE_TOOLS, ...TRANSFER_TOOLS, ...BROWSER_TOOLS].sort());
  });
});
