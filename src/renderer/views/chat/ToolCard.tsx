import type { ToolActivity } from "../../../core/conversations/transcript";
import { PLACES, detail, toolInfo } from "./tools";

export function ToolCard({ tool, waiting }: { tool: ToolActivity; waiting: boolean }) {
  const [label, place] = toolInfo(tool.name);
  const about = detail(tool.args);
  const state = tool.result !== null ? "done" : waiting ? "running" : "pending";

  return (
    <details className={`tool tool--${state} tool--${place}`}>
      <summary>
        <span className="tool__state" aria-hidden="true">{state === "done" ? "✓" : state === "running" ? "…" : "○"}</span>
        <span className="tool__label">{label}</span>
        <span className="tool__place">{PLACES[place]}</span>
        {about && <span className="tool__about selectable" title={about}>{about}</span>}
      </summary>
      <pre className="tool__result selectable">{tool.result ?? (waiting ? "En curso…" : "Sin respuesta todavía.")}</pre>
    </details>
  );
}
