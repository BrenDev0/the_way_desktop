import { describe, expect, it } from "vitest";
import { diff, fileTools } from "../../src/core/tools/files";
import { MemoryFileSystem } from "../support/memoryFileSystem";

function tools(seed: Record<string, string | Uint8Array> = {}) {
  const fs = new MemoryFileSystem(seed);
  return { fs, run: (name: string, args: Record<string, unknown>) => fileTools(fs)[name].run(args) };
}

describe("ReadFile", () => {
  it("returns the text with every line ending turned into \\n", async () => {
    const { run } = tools({ "notes.md": "one\r\ntwo\r\r\nthree\rfour" });
    expect(await run("ReadFile", { file_path: "notes.md" })).toBe("one\ntwo\nthree\nfour");
  });

  it("strips a UTF-8 byte order mark", async () => {
    const { run } = tools({ "bom.txt": new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]) });
    expect(await run("ReadFile", { file_path: "bom.txt" })).toBe("hi");
  });

  it("reads a file saved in the Windows code page", async () => {
    const { run } = tools({ "win.txt": new Uint8Array([0x63, 0x61, 0x66, 0xe9]) });
    expect(await run("ReadFile", { file_path: "win.txt" })).toBe("café");
  });

  it("refuses a binary file rather than decode garbage", async () => {
    const { run } = tools({ "image.png": new Uint8Array([0x89, 0x50, 0x00, 0x01]) });
    await expect(run("ReadFile", { file_path: "image.png" })).rejects.toThrow(/binary/);
  });

  it("turns reading a folder into a listing of what to read instead", async () => {
    const { run } = tools({ "docs/a.md": "a", "docs/b.md": "b" });
    await expect(run("ReadFile", { file_path: "docs" })).rejects.toThrow("It contains: a.md, b.md");
  });

  it("refuses a path that climbs out of the open folder", async () => {
    const { run } = tools({ "a.md": "a" });
    await expect(run("ReadFile", { file_path: "../secret.txt" })).rejects.toThrow(/outside/);
    await expect(run("ReadFile", { file_path: "C:/Windows/win.ini" })).rejects.toThrow(/absolute/);
  });
});

describe("ListDir", () => {
  it("lists folders first, then files with sizes", async () => {
    const { run } = tools({ "b.txt": "12345", "a/x.txt": "x", "C.md": "" });
    expect(await run("ListDir", {})).toBe("a/\nb.txt  (5 bytes)\nC.md  (0 bytes)");
  });
});

describe("SearchFile", () => {
  it("matches every word anywhere in the path, name hits first", async () => {
    const { run } = tools({
      "progreso/q3/report.md": "",
      "report-progreso.md": "",
      "other/report.md": "",
    });
    expect(await run("SearchFile", { file_name: "progreso report" })).toBe("report-progreso.md\nprogreso/q3/report.md");
  });

  it("skips build folders", async () => {
    const { run } = tools({ "node_modules/pkg/report.md": "", "src/report.md": "" });
    expect(await run("SearchFile", { file_name: "report" })).toBe("src/report.md");
  });
});

describe("SearchCode", () => {
  it("reports path:line: text and the true total", async () => {
    const { run } = tools({ "a.py": "import os\nuse_hubedi()\n", "b.py": "HUBEDI = 1\n" });
    const result = await run("SearchCode", { pattern: "hubedi" });
    expect(result).toContain("a.py:2: use_hubedi()");
    expect(result).toContain("b.py:1: HUBEDI = 1");
    expect(result).toContain("2 matching lines in 2 files (searched 2)");
  });

  it("keeps counting after the per-file cap so the total stays honest", async () => {
    const { run } = tools({ "big.txt": Array.from({ length: 15 }, () => "hit").join("\n") });
    const result = await run("SearchCode", { pattern: "hit" });
    expect(result).toContain("big.txt: ... and 5 more in this file");
    expect(result).toContain("15 matching lines in 1 file");
  });

  it("filters by glob and says so when nothing matches", async () => {
    const { run } = tools({ "a.py": "needle", "a.md": "needle" });
    expect(await run("SearchCode", { pattern: "needle", file_glob: "*.md", files_only: true })).toContain("a.md  (1 line)");
    expect(await run("SearchCode", { pattern: "absent", file_glob: "*.py" })).toMatch(/^No file matching \*\.py/);
  });

  it("explains an invalid pattern instead of failing", async () => {
    const { run } = tools({ "a.py": "x" });
    expect(await run("SearchCode", { pattern: "(" })).toMatch(/not a valid regular expression/);
  });
});

describe("CreateFile and UpdateFile", () => {
  it("refuses to overwrite without being told to", async () => {
    const { run, fs } = tools({ "a.md": "old" });
    await expect(run("CreateFile", { file_path: "a.md", content: "new" })).rejects.toThrow(/overwrite=true/);
    await run("CreateFile", { file_path: "a.md", content: "new", overwrite: true });
    expect(fs.text("a.md")).toBe("new");
  });

  it("creates missing parent folders", async () => {
    const { run, fs } = tools();
    await run("CreateFile", { file_path: "deep/er/file.txt", content: "x" });
    expect(fs.text("deep/er/file.txt")).toBe("x");
  });

  it("replaces exactly one occurrence, and refuses an ambiguous one", async () => {
    const { run, fs } = tools({ "a.css": "a{} b{} b{}" });
    await expect(run("UpdateFile", { file_path: "a.css", old_string: "b{}", new_string: "c{}" })).rejects.toThrow(/2 matches/);
    await run("UpdateFile", { file_path: "a.css", old_string: "a{}", new_string: "a{color:red}" });
    expect(fs.text("a.css")).toBe("a{color:red} b{} b{}");
    await run("UpdateFile", { file_path: "a.css", old_string: "b{}", new_string: "c{}", replace_all: true });
    expect(fs.text("a.css")).toBe("a{color:red} c{} c{}");
  });

  it("matches \\n edits against a file stored with \\r\\n, and writes \\n back", async () => {
    const { run, fs } = tools({ "a.txt": "one\r\ntwo\r\n" });
    await run("UpdateFile", { file_path: "a.txt", old_string: "one\ntwo", new_string: "1\n2" });
    expect(fs.text("a.txt")).toBe("1\n2\n");
  });

  it("treats $ in the replacement literally", async () => {
    const { run, fs } = tools({ "price.txt": "cost" });
    await run("UpdateFile", { file_path: "price.txt", old_string: "cost", new_string: "$& $1" });
    expect(fs.text("price.txt")).toBe("$& $1");
  });

  it("previews the change as a diff without writing it", async () => {
    const { fs } = tools({ "a.txt": "keep\nold\nkeep" });
    const preview = await fileTools(fs).UpdateFile.preview!({ file_path: "a.txt", old_string: "old", new_string: "new" });
    expect(preview).toContain("- old");
    expect(preview).toContain("+ new");
    expect(fs.text("a.txt")).toBe("keep\nold\nkeep");
  });
});

describe("CopyPath, MovePath and the delete tools", () => {
  it("copies a file into an existing folder under its own name", async () => {
    const { run, fs } = tools({ "a.txt": "x", "out/.keep": "" });
    expect(await run("CopyPath", { source: "a.txt", destination: "out" })).toBe("Copied a.txt to out/a.txt (1 bytes)");
    expect(fs.text("a.txt")).toBe("x");
  });

  it("refuses to copy a folder into itself", async () => {
    const { run } = tools({ "src/a.txt": "x" });
    await expect(run("CopyPath", { source: "src", destination: "src/inner" })).rejects.toThrow(/into itself/);
  });

  it("moves and renames, leaving nothing behind", async () => {
    const { run, fs } = tools({ "draft.md": "text" });
    await run("MovePath", { source: "draft.md", destination: "final/post.md" });
    expect(fs.text("final/post.md")).toBe("text");
    expect(fs.files.has("draft.md")).toBe(false);
  });

  it("renames a file or folder where it is", async () => {
    const { run, fs } = tools({ "docs/draft.md": "text", "docs/old/a.txt": "x" });
    expect(await run("RenamePath", { path: "docs/draft.md", new_name: "final.md" })).toBe("Renamed docs/draft.md to docs/final.md");
    await run("RenamePath", { path: "docs/old", new_name: "archive" });
    expect(fs.text("docs/final.md")).toBe("text");
    expect(fs.text("docs/archive/a.txt")).toBe("x");
    expect(fs.files.has("docs/draft.md")).toBe(false);
  });

  it("will not rename onto a name that is taken, or to a path", async () => {
    const { run, fs } = tools({ "a.md": "a", "b.md": "b" });
    await expect(run("RenamePath", { path: "a.md", new_name: "b.md" })).rejects.toThrow(/already exists/);
    await expect(run("RenamePath", { path: "a.md", new_name: "sub/b.md" })).rejects.toThrow(/plain name/);
    expect(fs.text("b.md")).toBe("b");
  });

  it("refuses to move or delete the open folder itself", async () => {
    const { run } = tools({ "a.txt": "x" });
    await expect(run("MovePath", { source: ".", destination: "elsewhere" })).rejects.toThrow(/open folder/);
    await expect(run("DeleteDir", { dir_path: ".", recursive: true })).rejects.toThrow(/open folder/);
  });

  it("deletes a non-empty folder only when told to", async () => {
    const { run, fs } = tools({ "old/a.txt": "x" });
    await expect(run("DeleteDir", { dir_path: "old" })).rejects.toThrow(/not empty/);
    await run("DeleteDir", { dir_path: "old", recursive: true });
    expect(fs.directories.has("old")).toBe(false);
  });

  it("points DeleteFile at DeleteDir for a folder", async () => {
    const { run } = tools({ "old/a.txt": "x" });
    await expect(run("DeleteFile", { file_path: "old" })).rejects.toThrow(/Use DeleteDir/);
  });
});

describe("diff", () => {
  it("shows only the changed region with context", () => {
    const result = diff("a.txt", "1\n2\n3\n4\n5\n6\n7\n8", "1\n2\n3\n4\nfive\n6\n7\n8", 1);
    expect(result.split("\n").slice(2)).toEqual(["@@ line 4 @@", "  4", "- 5", "+ five", "  6"]);
  });
});
