import { useState } from "react";
import type { AppUpdate } from "../../core/update";
import { errorText } from "./files/helpers";

/**
 * What to do about a newer version. On Windows the app installs it itself: one press, one
 * confirmation (the app closes and opens again), and it downloads, installs and restarts. When that
 * fails it says why and the page is still there; elsewhere it is the page.
 */
export function UpdateAction({ update, className }: { update: AppUpdate; className: string }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "installing">("idle");
  const [problem, setProblem] = useState<string | null>(null);

  const page = update.downloadPageUrl ? (
    <button type="button" className={className} onClick={() => void window.desktop.links.open(update.downloadPageUrl!)}>
      DESCARGAR {update.latest}
    </button>
  ) : null;

  if (!update.canInstall) return page;

  async function install() {
    setProblem(null);
    setPhase("installing");
    try {
      await window.desktop.app.installUpdate();
    } catch (reason) {
      setProblem(errorText(reason));
    }
    // reached only if the app did not quit: something went wrong, or it was already running
    setPhase("idle");
  }

  if (phase === "installing") {
    return <span role="status" className="update-action__busy">Descargando e instalando… la app se cerrará sola y volverá a abrirse.</span>;
  }
  if (phase === "confirm") {
    return (
      <span className="update-action">
        <span>Se cerrará la app, se instalará la versión {update.latest} y se abrirá de nuevo. ¿Continuar?</span>
        <button type="button" className={className} onClick={() => void install()}>ACTUALIZAR AHORA</button>
        <button type="button" className={className} onClick={() => setPhase("idle")}>NO</button>
      </span>
    );
  }
  return (
    <span className="update-action">
      <button type="button" className={className} onClick={() => { setProblem(null); setPhase("confirm"); }}>
        ACTUALIZAR {update.latest}
      </button>
      {problem && <span role="alert" className="update-action__problem">{problem}</span>}
      {problem && page}
    </span>
  );
}
