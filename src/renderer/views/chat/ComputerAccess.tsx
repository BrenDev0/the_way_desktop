import { useEffect, useState } from "react";
import type { ComputerActivity, ComputerGrant } from "../../../core/computer/access";

const WHAT: Record<string, string> = {
  RequestComputerAccess: "Pidió acceso",
  ListComputerFolder: "Listó",
  SearchComputer: "Buscó nombres",
  SearchComputerText: "Buscó texto",
  ReadComputerFile: "Leyó",
  GrantAdded: "Diste acceso a",
  GrantRemoved: "Quitaste el acceso a",
};

function when(at: string): string {
  return new Date(at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ComputerAccess() {
  const [grants, setGrants] = useState<ComputerGrant[]>([]);
  const [log, setLog] = useState<ComputerActivity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.desktop.computer.grants().then(setGrants, () => setError("No se pudo leer la lista."));
    window.desktop.computer.log().then(setLog, () => undefined);
  }, []);

  async function change<T>(run: () => Promise<T>, apply: (value: T) => void, alsoLog = true) {
    setError(null);
    try {
      apply(await run());
      if (alsoLog) setLog(await window.desktop.computer.log());
    } catch {
      setError("No se pudo cambiar el acceso.");
    }
  }

  return (
    <div className="place__body place__access">
      <p className="place__hint">
        Carpetas de solo lectura: AGENTIX puede buscar y leer en ellas, nunca modificarlas. Te pedirá acceso cuando lo necesite.
        Lo que lea se envía al servidor y al proveedor de IA para poder responderte.
      </p>
      {grants.length ? (
        <ul className="place__folders" aria-label="Carpetas con acceso de lectura">
          {grants.map((grant) => (
            <li key={grant.id} className="place__current">
              <span className="selectable" title={grant.path}>{grant.label}</span>
              <button type="button" className="ghost-button" onClick={() => void change(() => window.desktop.computer.remove(grant.id), setGrants)}>
                QUITAR
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="place__none">Ninguna carpeta con acceso todavía.</p>}
      <button type="button" className="ghost-button place__choose" onClick={() => void change(window.desktop.computer.add, setGrants)}>
        ▣ AÑADIR CARPETA…
      </button>

      <div className="place__log-head">
        <span>ACTIVIDAD</span>
        <span>
          <button type="button" className="ghost-button" onClick={() => void change(window.desktop.computer.log, setLog, false)}>ACTUALIZAR</button>
          {log.length > 0 && (
            <button type="button" className="ghost-button" onClick={() => void change(window.desktop.computer.clearLog, setLog, false)}>BORRAR</button>
          )}
        </span>
      </div>
      {log.length ? (
        <ul className="place__log" aria-label="Lo que AGENTIX hizo en tu equipo">
          {log.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className={entry.ok ? undefined : "place__log--failed"} title={entry.note ?? entry.detail}>
              <span className="place__log-when">{when(entry.at)}</span>
              <span>{entry.ok ? "" : "✕ "}{WHAT[entry.tool] ?? entry.tool} {entry.detail}</span>
            </li>
          ))}
        </ul>
      ) : <p className="place__none">AGENTIX todavía no ha leído nada.</p>}
      {error && <p className="place__error" role="alert">{error}</p>}
    </div>
  );
}
