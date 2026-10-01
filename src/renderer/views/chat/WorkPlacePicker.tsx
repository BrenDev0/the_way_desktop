import { useEffect, useRef, useState, type ReactElement } from "react";
import type { WorkingPlace } from "../../../core/bridge";
import type { ProjectRef, RemoteTree } from "../../../core/tools/ports";
import { ProjectTree } from "../../../core/workspace/remoteTree";

interface Props {
  place: WorkingPlace;
  projects: ProjectRef[];
  onChooseLocal(): Promise<void>;
  onUse(mode: "local" | "remote"): Promise<void>;
  onSetRemote(project: string, path: string): Promise<void>;
}

/** A folder by its own name -- "Desktop", not the whole path. */
function nameOf(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

/**
 * Where the agent works, chosen right by the message box: a folder on this computer
 * (LOCAL) or a project on the server, or a folder in one (REMOTO). The chip says which is
 * in use; the one not in use is remembered, to switch back to in one click.
 *
 * REMOTO is one tree of every project, side by side as in the files panel: any project or
 * folder in it is picked with a click, and its arrow opens it to show what is inside.
 */
export function WorkPlacePicker({ place, projects, onChooseLocal, onUse, onSetRemote }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"local" | "remote">(place.mode);
  const [trees, setTrees] = useState<Map<string, ProjectTree>>(new Map());
  // what is opened to show its inside: projects by id, folders by "project id/folder id"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab(place.mode);
    setError(null);
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open, place.mode]);

  const remote = place.mode === "remote" ? place.remote : null;

  // every project's folders, read when REMOTO is looked at; the one in use starts open
  useEffect(() => {
    if (!open || tab !== "remote") return;
    let cancelled = false;
    for (const project of projects) {
      window.desktop.projects.tree(project.id).then(
        (loaded) => {
          if (cancelled) return;
          const tree = new ProjectTree(loaded as RemoteTree);
          setTrees((current) => new Map(current).set(project.id, tree));
          if (remote && remote.project.toLowerCase() === project.name.toLowerCase()) {
            const inUse = remote.path ? tree.findFolder(remote.path) : null;
            setExpanded((current) => new Set([
              ...current,
              project.id,
              ...(inUse ? tree.ancestors(inUse.id).map((id) => `${project.id}/${id}`) : []),
            ]));
          }
        },
        () => { if (!cancelled) setError(`No se pudo leer ${project.name}.`); },
      );
    }
    return () => { cancelled = true; };
    // the place in use is read once per opening: following it while open would refold the tree
  }, [open, tab, projects]);

  async function act(run: () => Promise<void>) {
    setError(null);
    try {
      await run();
      setOpen(false);
    } catch {
      setError("No se pudo cambiar la carpeta de trabajo.");
    }
  }

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** One pickable row: an arrow that opens it when it has an inside, and its name. */
  function row(key: string, depth: number, name: string, project: ProjectRef, path: string, opens: boolean, isProject: boolean) {
    const inUse = !!remote && remote.project.toLowerCase() === project.name.toLowerCase() && remote.path === path;
    const isOpen = expanded.has(key);
    return (
      <div className={inUse ? "place__folder place__folder--on" : "place__folder"} style={{ paddingLeft: 4 + depth * 14 }}>
        <button
          type="button"
          className="place__caret"
          onClick={() => opens && toggle(key)}
          disabled={!opens}
          aria-label={opens ? (isOpen ? `Cerrar ${name}` : `Abrir ${name}`) : undefined}
          aria-expanded={opens ? isOpen : undefined}
          tabIndex={opens ? 0 : -1}
        >
          {opens ? (isOpen ? "▾" : "▸") : ""}
        </button>
        <button
          type="button"
          className="place__pick"
          onClick={() => void act(() => onSetRemote(project.name, path))}
          title={`Trabajar en ${path ? `${project.name}/${path}` : `${project.name} (todo el proyecto)`}`}
        >
          <span aria-hidden="true">{isProject ? "◆" : "▣"}</span>
          <span className="place__folder-name">{name}</span>
          {inUse && <span className="place__badge">EN USO</span>}
        </button>
      </div>
    );
  }

  function folders(project: ProjectRef, tree: ProjectTree, parentId: string | null, depth: number): ReactElement[] {
    return tree.children(parentId).filter((entry) => entry.kind === "folder").map((entry) => {
      const key = `${project.id}/${entry.id}`;
      const opens = tree.children(entry.id).some((child) => child.kind === "folder");
      return (
        <li key={key}>
          {row(key, depth, entry.name, project, entry.path, opens, false)}
          {opens && expanded.has(key) && <ul>{folders(project, tree, entry.id, depth + 1)}</ul>}
        </li>
      );
    });
  }

  const label = remote
    ? [remote.project, remote.path].filter(Boolean).join("/")
    : place.local ? nameOf(place.local) : "ELEGIR CARPETA";
  const chipClass = remote
    ? "chat__folder-chip chat__folder-chip--remote"
    : place.local ? "chat__folder-chip" : "chat__folder-chip chat__folder-chip--none";

  return (
    <div className="place" ref={root}>
      <button
        type="button"
        className={chipClass}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={remote
          ? `Carpeta de trabajo en el servidor: ${label}. Clic para cambiarla.`
          : place.local ? `Carpeta de trabajo en este equipo: ${place.local}. Clic para cambiarla.` : "Elige dónde trabaja el agente."}
      >
        <span aria-hidden="true">{remote ? "☁" : "▣"}</span>
        <span className="chat__folder-name">{label}</span>
      </button>

      {open && (
        <div className="place__menu" role="dialog" aria-label="Carpeta de trabajo">
          <div className="place__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "local"} className={tab === "local" ? "place__tab place__tab--on" : "place__tab"} onClick={() => setTab("local")}>
              ▣ LOCAL
            </button>
            <button type="button" role="tab" aria-selected={tab === "remote"} className={tab === "remote" ? "place__tab place__tab--on place__tab--remote" : "place__tab"} onClick={() => setTab("remote")}>
              ☁ REMOTO
            </button>
          </div>

          {tab === "local" ? (
            <div className="place__body">
              <p className="place__hint">Una carpeta de este equipo: el agente lee, crea y modifica archivos ahí.</p>
              {place.local ? (
                <div className={place.mode === "local" ? "place__current place__current--on" : "place__current"}>
                  <span className="selectable" title={place.local}>{place.local}</span>
                  {place.mode === "local"
                    ? <span className="place__badge">EN USO</span>
                    : <button type="button" className="ghost-button" onClick={() => void act(() => onUse("local"))}>USAR</button>}
                </div>
              ) : <p className="place__none">Todavía no hay una carpeta local elegida.</p>}
              <button type="button" className="ghost-button place__choose" onClick={() => void act(onChooseLocal)}>
                ▣ {place.local ? "ELEGIR OTRA CARPETA…" : "ELEGIR CARPETA…"}
              </button>
            </div>
          ) : (
            <div className="place__body">
              <p className="place__hint">Un proyecto del servidor, o una carpeta dentro: el agente trabaja y entrega ahí. ▸ abre lo que hay dentro.</p>
              {projects.length ? (
                <ul className="place__folders" aria-label="Proyectos y carpetas">
                  {projects.map((project) => {
                    const tree = trees.get(project.id);
                    const opens = !tree || tree.children(null).some((child) => child.kind === "folder");
                    return (
                      <li key={project.id}>
                        {row(project.id, 0, project.name, project, "", opens, true)}
                        {expanded.has(project.id) && (
                          tree ? <ul>{folders(project, tree, null, 1)}</ul> : <p className="place__none" style={{ paddingLeft: 32 }}>Leyendo carpetas…</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="place__none">No tienes proyectos todavía. Créalos desde el panel REMOTO.</p>}
            </div>
          )}
          {error && <p className="place__error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
