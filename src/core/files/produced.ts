/**
 * The files an agent's tool reports having made, read out of what it said -- so a chat's
 * tool card or a task's card can offer each one to open.
 *
 * The server's tools report in a few fixed shapes:
 *   Wrote Borradores/informe/index.html (12,345 bytes).        WriteProjectFile, BuildHtmlPage
 *   Saved Borradores/informe/index.pdf (2 pages, ...).         HtmlToPdf, HtmlToPng
 *   - saved Borradores/campana/banner.png (812,004 bytes)      GenerateImages, EditImage
 *   Renamed Web/draft.md to Web/final.md                       RenameProjectPath
 *   Moved Web/draft.md to Web/final/post.md                    MoveProjectPath
 *   Files in .the_way/tasks/x-1a2b/: a.html, b.pdf.            a background task's output
 *   Delivered to Borradores/x-1a2b: index.html (1 file), img (3 files)   DeliverTask
 */

export interface ProducedFile {
  project: string;
  path: string;
  /** A delivered folder opens in the files panel rather than the viewer. */
  kind: "file" | "folder";
}

const WROTE = /(?:^|[\s-])(?:Wrote|Saved|saved) ([^\n/]+\/[^\n]+?) \(/g;
const RENAMED = /(?:Renamed|Moved|Copied) [^\n]+? to ([^\n/]+\/[^\n]+?)(?: \(|\.?$)/gm;
const PRODUCED = /Files in \.the_way\/([^\n:]+?)\/?: ([^\n]+?)\.?$/gm;
const DELIVERED = /Delivered to ([^\n/]+)\/([^\n:(]*?)(?: \([^\n)]*\))?: ([^\n]+)/g;
const DELIVERED_ITEM = /^(.+?) \((\d+) files?\)$/;

export function producedFiles(text: string | null | undefined): ProducedFile[] {
  if (!text) return [];
  const found: ProducedFile[] = [];
  const add = (project: string, path: string, kind?: ProducedFile["kind"]) => {
    const clean = path.trim().replace(/^\/+|\/+$/g, "").replace(/\.$/, "");
    if (!project.trim() || !clean) return;
    // a name with no extension is a folder: a moved or copied directory
    const named = kind ?? (clean.split("/").pop()!.includes(".") ? "file" : "folder");
    found.push({ project: project.trim(), path: clean, kind: named });
  };
  const split = (full: string) => {
    const slash = full.indexOf("/");
    add(full.slice(0, slash), full.slice(slash + 1));
  };

  for (const match of text.matchAll(WROTE)) split(match[1]);
  for (const match of text.matchAll(RENAMED)) split(match[1]);
  for (const match of text.matchAll(PRODUCED)) {
    for (const name of match[2].split(", ")) add(".the_way", `${match[1]}/${name}`);
  }
  for (const match of text.matchAll(DELIVERED)) {
    for (const item of match[3].split(", ")) {
      const parsed = DELIVERED_ITEM.exec(item.trim());
      if (!parsed) continue;
      // copy() reports where each item landed inside the project
      add(match[1], parsed[1], parsed[1].includes(".") && parsed[2] === "1" ? "file" : "folder");
    }
  }

  const seen = new Set<string>();
  return found.filter((file) => {
    const key = `${file.project.toLowerCase()}/${file.path.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type ViewKind = "image" | "pdf" | "html" | "markdown" | "text" | "other";

const TEXT_TYPES = ["application/json", "application/xml", "text/"];

/** How a file can be shown inside the app, from its type and, failing that, its name. */
export function viewKind(contentType: string, name: string): ViewKind {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const suffix = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(suffix)) return "image";
  if (type === "application/pdf" || suffix === "pdf") return "pdf";
  if (type === "text/html" || suffix === "html" || suffix === "htm") return "html";
  if (type === "text/markdown" || suffix === "md" || suffix === "markdown") return "markdown";
  if (TEXT_TYPES.some((t) => type.startsWith(t)) || ["md", "txt", "csv", "json", "log", "yaml", "yml"].includes(suffix)) return "text";
  return "other";
}
