import { describe, expect, it } from "vitest";
import { producedFiles, viewKind } from "../../src/core/files/produced";

describe("producedFiles", () => {
  it("reads every file a tool reports saving", () => {
    expect(producedFiles("Wrote Borradores/informe/index.html (12,345 bytes).")).toEqual([
      { project: "Borradores", path: "informe/index.html", kind: "file" },
    ]);
    expect(producedFiles("Saved Mis Clientes/q3/informe.pdf (2 pages, scaled to 54% so content fits).")).toEqual([
      { project: "Mis Clientes", path: "q3/informe.pdf", kind: "file" },
    ]);
    expect(
      producedFiles("Generated with Flare (gpt-image-2.5-flare):\n- saved Borradores/a.png (812 bytes)\n- b.png: FAILED -- no image"),
    ).toEqual([{ project: "Borradores", path: "a.png", kind: "file" }]);
  });

  it("follows a rename, move or copy to where the file landed", () => {
    expect(producedFiles("Renamed Web/draft.md to Web/final.md")).toEqual([{ project: "Web", path: "final.md", kind: "file" }]);
    expect(producedFiles("Copied 3 file(s) from Web/kit to Otro/incoming/kit")).toEqual([
      { project: "Otro", path: "incoming/kit", kind: "folder" },
    ]);
  });

  it("reads a task's output and its delivery", () => {
    const result =
      "Files in .the_way/tasks/informe-1a2b/: index.html, img/hero.png.\nListo.\n" +
      "Delivered to Borradores/informe-1a2b (dropped the redundant x/ level the worker added): " +
      "informe-1a2b/index.html (1 file), informe-1a2b/img (2 files)";

    expect(producedFiles(result)).toEqual([
      { project: ".the_way", path: "tasks/informe-1a2b/index.html", kind: "file" },
      { project: ".the_way", path: "tasks/informe-1a2b/img/hero.png", kind: "file" },
      { project: "Borradores", path: "informe-1a2b/index.html", kind: "file" },
      { project: "Borradores", path: "informe-1a2b/img", kind: "folder" },
    ]);
  });

  it("finds nothing in text that saved nothing", () => {
    expect(producedFiles("Deleted Web/old")).toEqual([]);
    expect(producedFiles(null)).toEqual([]);
  });
});

describe("viewKind", () => {
  it("picks how a file can be shown", () => {
    expect(viewKind("image/png", "a.png")).toBe("image");
    expect(viewKind("application/octet-stream", "a.svg")).toBe("image");
    expect(viewKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(viewKind("text/html; charset=utf-8", "a.html")).toBe("html");
    expect(viewKind("text/markdown", "a.md")).toBe("markdown");
    expect(viewKind("application/octet-stream", "notes.md")).toBe("markdown");
    expect(viewKind("text/plain", "README.markdown")).toBe("markdown");
    expect(viewKind("text/plain", "notes.txt")).toBe("text");
    expect(viewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx")).toBe("other");
  });
});
