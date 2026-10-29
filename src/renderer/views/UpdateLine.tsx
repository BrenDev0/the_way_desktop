import { useState } from "react";
import { describeCheck, type UpdateCheck } from "../../core/update";
import { UpdateAction } from "./UpdateAction";

/** The installed version, where it stands against what the server has published, and a button
 *  to ask again. Always there, so the person can see the check works even when there is
 *  nothing to update to; the banner in the chat only appears when there is. */
export function UpdateLine({ check, onCheck }: { check: UpdateCheck | null; onCheck: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const { version, text, update } = describeCheck(check);

  async function ask() {
    setBusy(true);
    try {
      await onCheck();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rail__version">
      <div className="rail__version-head">
        <span>{version ? `VERSIÓN ${version}` : "VERSIÓN"}</span>
        <button
          type="button"
          className="ghost-button"
          title="Buscar actualizaciones"
          onClick={() => void ask()}
          disabled={busy}
        >
          {busy ? "BUSCANDO…" : "BUSCAR"}
        </button>
      </div>
      <p className="rail__version-text" role="status">
        {busy ? "Buscando actualizaciones…" : text}
      </p>
      {!busy && update && <UpdateAction update={update} className="ghost-button rail__version-download" />}
    </div>
  );
}
