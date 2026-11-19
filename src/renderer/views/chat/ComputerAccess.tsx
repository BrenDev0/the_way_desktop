import { useEffect, useState } from "react";
import type { ComputerGrant } from "../../../core/computer/access";

export function ComputerAccess() {
  const [grants, setGrants] = useState<ComputerGrant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.desktop.computer.grants().then(setGrants, () => setError("No se pudo leer la lista."));
  }, []);

  async function change(run: () => Promise<ComputerGrant[]>) {
    setError(null);
    try {
      setGrants(await run());
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
              <button type="button" className="ghost-button" onClick={() => void change(() => window.desktop.computer.remove(grant.id))}>
                QUITAR
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="place__none">Ninguna carpeta con acceso todavía.</p>}
      <button type="button" className="ghost-button place__choose" onClick={() => void change(window.desktop.computer.add)}>
        ▣ AÑADIR CARPETA…
      </button>
      {error && <p className="place__error" role="alert">{error}</p>}
    </div>
  );
}
