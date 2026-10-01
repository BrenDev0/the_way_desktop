import type { ViewTarget } from "../../../core/bridge";
import { viewKind } from "../../../core/files/produced";

/** What the viewer is asked to open: a project file, or one in the open folder. */
export type ViewRequest = { source: "project"; project: string; path: string } | { source: "local"; path: string };

const GLYPH = { image: "▣", pdf: "▤", html: "◈", markdown: "¶", text: "≡", other: "◇" } as const;

/** The files something produced, each a button that opens it. */
export function FileChips({
  files,
  onOpen,
}: {
  files: (ViewTarget | { local: string })[];
  onOpen(target: ViewTarget | { local: string }): void;
}) {
  if (!files.length) return null;
  return (
    <div className="file-chips">
      {files.map((file) => {
        const path = "local" in file ? file.local : file.path;
        const name = path.split("/").pop() ?? path;
        const folder = !("local" in file) && file.kind === "folder";
        const where = "local" in file ? "este equipo" : file.project;
        return (
          <button
            type="button"
            key={`${where}/${path}`}
            className={folder ? "file-chip file-chip--folder" : "file-chip"}
            onClick={() => onOpen(file)}
            title={`${folder ? "Ver carpeta" : "Abrir"} ${where}/${path}`}
          >
            <span className="file-chip__glyph" aria-hidden="true">{folder ? "▸" : GLYPH[viewKind("", name)]}</span>
            <span className="file-chip__name">{name}</span>
            <span className="file-chip__where">{where}</span>
          </button>
        );
      })}
    </div>
  );
}
