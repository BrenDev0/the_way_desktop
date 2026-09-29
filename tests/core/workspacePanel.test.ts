import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/core/api";
import { UploadLimitError } from "../../src/core/tools/transfer";
import { LocalFilesError } from "../../src/core/workspace/localFiles";
import { operatorMessage } from "../../src/core/workspace/messages";
import { ProjectTree } from "../../src/core/workspace/remoteTree";

describe("ProjectTree", () => {
  const tree = new ProjectTree({
    folders: [
      { id: "b", parentId: null, name: "entregas" },
      { id: "c", parentId: "b", name: "2026" },
      { id: "a", parentId: null, name: "Assets" },
    ],
    files: [
      { id: "f1", folderId: "c", name: "informe.pdf", sizeBytes: 10, status: "ready" },
      { id: "f2", folderId: null, name: "brief.md", sizeBytes: 3, status: "ready" },
    ],
  });

  it("nests the flat lists, folders first and alphabetical", () => {
    expect(tree.children(null).map((e) => `${e.kind}:${e.name}`)).toEqual(["folder:Assets", "folder:entregas", "file:brief.md"]);
    expect(tree.children("b").map((e) => e.name)).toEqual(["2026"]);
  });

  it("gives each entry the path the transfer functions resolve", () => {
    expect(tree.children("c")[0].path).toBe("entregas/2026/informe.pdf");
    expect(tree.folderPath("c")).toBe("entregas/2026");
    expect(tree.children(null)[2].path).toBe("brief.md");
  });

  it("finds a delivered folder by path and the folders it sits inside", () => {
    expect(tree.findFolder("Entregas/2026/")).toMatchObject({ kind: "folder", id: "c", path: "entregas/2026" });
    expect(tree.findFolder("nope")).toBeNull();
    expect(tree.ancestors("c")).toEqual(["b"]);
    expect(tree.ancestors("a")).toEqual([]);
  });
});

describe("operatorMessage", () => {
  it("says server errors in the operator's words", () => {
    expect(operatorMessage(new ApiError(409, "project_name_taken", "taken"))).toBe("Ya tienes un proyecto con ese nombre.");
    expect(operatorMessage(new ApiError(500, "something_new", "boom"))).toBe("El servidor no pudo completar la acción.");
  });

  it("restates the agent-facing limits and tool errors", () => {
    expect(operatorMessage(new UploadLimitError("x", "files", 812))).toMatch(/812 archivos/);
    expect(operatorMessage(new UploadLimitError("x", "bytes", 700 * 1048576))).toMatch(/700 MB/);
    expect(operatorMessage(new Error("No folder is open in the desktop app"))).toBe("Elige primero una carpeta de trabajo.");
    expect(operatorMessage(new LocalFilesError("Ya existe \"a\" en esa carpeta."))).toBe("Ya existe \"a\" en esa carpeta.");
  });
});
