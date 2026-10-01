import type { ViewTarget } from "../../../core/bridge";
import type { ToolActivity } from "../../../core/conversations/transcript";
import { producedFiles } from "../../../core/files/produced";
import { FileChips } from "../files/FileChips";
import { PLACES, detail, toolInfo } from "./tools";

// Desktop tools that leave a file on this computer, and the argument naming it.
const LOCAL_OUTPUT: Record<string, string> = { CreateFile: "file_path", UpdateFile: "file_path" };

export type OpenTarget = ViewTarget | { local: string };

export function ToolCard({
  tool,
  waiting,
  onOpenFile,
}: {
  tool: ToolActivity;
  waiting: boolean;
  onOpenFile?(target: OpenTarget): void;
}) {
  const [label, place] = toolInfo(tool.name);
  const about = detail(tool.args);
  const state = tool.result !== null ? "done" : waiting ? "running" : "pending";
  const files = onOpenFile && tool.result !== null ? made(tool) : [];

  return (
    <div className={`tool tool--${state} tool--${place}`}>
      <details>
        <summary>
          <span className="tool__state" aria-hidden="true">{state === "done" ? "✓" : state === "running" ? "…" : "○"}</span>
          <span className="tool__label">{label}</span>
          <span className="tool__place">{PLACES[place]}</span>
          {about && <span className="tool__about selectable" title={about}>{about}</span>}
        </summary>
        <pre className="tool__result selectable">{tool.result ?? (waiting ? "En curso…" : "Sin respuesta todavía.")}</pre>
      </details>
      {onOpenFile && <FileChips files={files} onOpen={onOpenFile} />}
    </div>
  );
}

/** The files this call reports having made, to open from the card. */
function made(tool: ToolActivity): OpenTarget[] {
  const local = LOCAL_OUTPUT[tool.name];
  if (local) {
    const path = tool.args[local];
    const failed = /^(?:\w*Error|Refus|Nothing|File does not exist)/.test(tool.result ?? "");
    return typeof path === "string" && path && !failed ? [{ local: path.replace(/\\/g, "/") }] : [];
  }
  return producedFiles(tool.result);
}
