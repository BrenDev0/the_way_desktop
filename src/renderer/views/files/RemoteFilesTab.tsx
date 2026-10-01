import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { ProjectRef, RemoteTree } from "../../../core/tools/ports";
import { ProjectTree, type RemoteEntry } from "../../../core/workspace/remoteTree";
import type { ViewRequest } from "./FileChips";
import { errorText, formatSize, pipe, plural, type Notice } from "./helpers";

/** A project folder to show, e.g. where a task delivered its work. */
export interface RemoteFocus {
  project: string;
  path: string | null;
}

interface Props {
  projects: ProjectRef[];
  folder: string | null;
  /** The local folder a download writes into (the one selected in the local tree). */
  localTarget: string;
  /** Bumped when the project trees may have changed (an upload, an agent turn). */
  refreshKey: number;
  focus: RemoteFocus | null;
  onProjectsChanged(): Promise<void>;
  onDownloaded(): void;
  /** Opens a file in the viewer. */
  onView?(request: ViewRequest): void;
  /** Where the agent works now, when it is on the server: marked EN USO in the tree. */
  workingRemote?: { project: string; path: string } | null;
  /** Makes the selected project or folder where the agent works. */
  onWorkHere?(project: string, path: string): Promise<void>;
}

type Selection = { project: ProjectRef; entry: RemoteEntry | null } | null;

/** Every project on the server as one tree: projects at the top, their folders below. */
export function RemoteFilesTab({ projects, folder, localTarget, refreshKey, focus, onProjectsChanged, onDownloaded, onView, workingRemote, onWorkHere }: Props) {
  const [trees, setTrees] = useState<Map<string, ProjectTree>>(new Map());
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selection>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const loaded = useRef(new Set<string>());

  const loadTree = useCallback(async (project: ProjectRef): Promise<ProjectTree> => {
    const tree = new ProjectTree((await window.desktop.projects.tree(project.id)) as RemoteTree);
    loaded.current.add(project.id);
    setTrees((current) => new Map(current).set(project.id, tree));
    return tree;
  }, []);

  // after an upload or a turn, re-read the projects that are open
  useEffect(() => {
    if (!refreshKey) return;
    for (const project of projects) if (loaded.current.has(project.id)) void loadTree(project).catch(() => {});
  }, [refreshKey, projects, loadTree]);

  // A delivered folder: open its project and every folder on the way, and select it.
  useEffect(() => {
    if (!focus) return;
    const project = projects.find((p) => p.name.toLowerCase() === focus.project.toLowerCase());
    if (!project) return;
    let cancelled = false;
    void loadTree(project).then((tree) => {
      if (cancelled) return;
      setOpenProjects((current) => new Set(current).add(project.id));
      const wanted = (focus.path ?? "").replace(/^\/+|\/+$/g, "").toLowerCase();
      const entry = wanted ? tree.findFolder(wanted) : null;
      if (entry) setOpenFolders((current) => new Set([...current, ...tree.ancestors(entry.id), entry.id]));
      setSelected({ project, entry });
    }).catch((error) => setNotice({ error: true, text: errorText(error) }));
    return () => { cancelled = true; };
  }, [focus, projects, loadTree]);

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await run();
    } catch (error) {
      setNotice({ error: true, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleProject(project: ProjectRef) {
    setSelected({ project, entry: null });
    setConfirmDelete(false);
    const open = new Set(openProjects);
    if (open.has(project.id)) open.delete(project.id);
    else {
      open.add(project.id);
      if (!trees.has(project.id)) await act(async () => { await loadTree(project); });
    }
    setOpenProjects(open);
  }

  async function createProject() {
    const name = creating?.trim();
    setCreating(null);
    if (!name) return;
    await act(async () => {
      const created = await window.desktop.projects.create(name);
      await onProjectsChanged();
      setSelected({ project: created, entry: null });
      setNotice({ error: false, text: `Proyecto "${created.name}" creado.` });
    });
  }

  async function download() {
    if (!selected) return;
    const { project, entry } = selected;
    await act(async () => {
      const result = await window.desktop.projects.download(project.name, entry?.path ?? "", localTarget);
      setNotice({ error: false, text: `${plural(result.written.length, "archivo descargado", "archivos descargados")} en ${localTarget || "la carpeta de trabajo"}.` });
      onDownloaded();
    });
  }

  async function remove() {
    if (!selected?.entry) return;
    const { project, entry } = selected;
    setConfirmDelete(false);
    await act(async () => {
      await window.desktop.projects.removeEntry(project.id, entry.kind, entry.id);
      setSelected({ project, entry: null });
      await loadTree(project);
      setNotice({ error: false, text: `"${entry.name}" eliminado de ${project.name}.` });
    });
  }

  /** Whether this project ("" path) or folder is where the agent works now. */
  const inUse = (project: ProjectRef, path: string) =>
    !!workingRemote && workingRemote.project.toLowerCase() === project.name.toLowerCase() && workingRemote.path === path;

  // the selected project, or a folder in one -- a file is not a place to work in
  const workable = selected && (!selected.entry || selected.entry.kind === "folder")
    ? { project: selected.project.name, path: selected.entry?.path ?? "" }
    : null;

  async function workHere() {
    if (!workable || !onWorkHere) return;
    await act(async () => {
      await onWorkHere(workable.project, workable.path);
      setNotice({ error: false, text: `El agente trabaja ahora en ${workable.path ? `${workable.project}/${workable.path}` : workable.project}.` });
    });
  }

  function entries(project: ProjectRef, tree: ProjectTree, parentId: string | null, depth: number): ReactElement[] {
    return tree.children(parentId).map((entry) => {
      const open = entry.kind === "folder" && openFolders.has(entry.id);
      const pending = entry.kind === "file" && entry.file.status !== "ready";
      return (
        <li key={entry.id} {...pipe(depth)}>
          <button
            type="button"
            className={selected?.entry?.id === entry.id ? "tree__row tree__row--selected" : "tree__row"}
            style={{ paddingLeft: 10 + depth * 14 }}
            title={`${project.name}/${entry.path}`}
            onClick={() => {
              setSelected({ project, entry });
              setConfirmDelete(false);
              if (entry.kind === "folder") {
                setOpenFolders((current) => {
                  const next = new Set(current);
                  if (next.has(entry.id)) next.delete(entry.id);
                  else next.add(entry.id);
                  return next;
                });
              }
            }}
            onDoubleClick={() => {
              if (entry.kind === "file" && !pending) onView?.({ source: "project", project: project.name, path: entry.path });
            }}
          >
            <span className="tree__icon" aria-hidden="true">{entry.kind === "folder" ? (open ? "▾" : "▸") : "◻"}</span>
            <span className="tree__name">{entry.name}{entry.kind === "folder" ? "/" : ""}</span>
            {entry.kind === "file" && <span className="tree__meta">{pending ? "subiendo…" : formatSize(entry.file.sizeBytes)}</span>}
            {entry.kind === "folder" && inUse(project, entry.path) && <span className="tree__badge">EN USO</span>}
          </button>
          {open && <ul>{entries(project, tree, entry.id, depth + 1)}</ul>}
        </li>
      );
    });
  }

  const what = !selected ? null : selected.entry ? `"${selected.entry.name}"` : `todo ${selected.project.name}`;
  const viewable = selected?.entry?.kind === "file" && selected.entry.file.status === "ready";

  return (
    <div className="files__body">
      <div className="files__toolbar" role="toolbar" aria-label="Acciones del servidor">
        <button type="button" className="ghost-button" onClick={() => setCreating("")} disabled={busy}>+ PROYECTO</button>
        {onWorkHere && (
          <button
            type="button"
            className="ghost-button"
            disabled={busy || !workable || inUse(selected!.project, workable.path)}
            onClick={() => void workHere()}
            title={workable ? `Que el agente trabaje en ${workable.path ? `${workable.project}/${workable.path}` : workable.project}` : "Selecciona un proyecto o una carpeta"}
          >
            ◆ TRABAJAR AQUÍ
          </button>
        )}
        {onView && (
          <button
            type="button"
            className="ghost-button"
            disabled={!viewable}
            onClick={() => viewable && selected?.entry && onView({ source: "project", project: selected.project.name, path: selected.entry.path })}
            title="Ver el archivo (o doble clic)"
          >
            ◉ VER
          </button>
        )}
        <button type="button" className="ghost-button" disabled={busy || !selected || !folder} onClick={() => void download()} title={folder ? "Descargar a la carpeta local seleccionada" : "Elige primero una carpeta de trabajo"}>
          ↓ DESCARGAR
        </button>
        <button type="button" className="ghost-button ghost-button--icon ghost-button--danger" disabled={busy || !selected?.entry} onClick={() => setConfirmDelete(true)} title="Eliminar del proyecto" aria-label="Eliminar del proyecto">✕</button>
        <button type="button" className="ghost-button ghost-button--icon" disabled={busy} title="Actualizar" aria-label="Actualizar"
          onClick={() => void act(async () => {
            await onProjectsChanged();
            for (const project of projects) if (loaded.current.has(project.id)) await loadTree(project);
          })}>↻</button>
      </div>
      {what && folder && (
        <p className="files__hint">
          Descargar {what} en <span className="selectable">{localTarget || "la carpeta de trabajo"}</span>. Si algo ya existe en este equipo, se detiene sin reemplazarlo.
        </p>
      )}

      {confirmDelete && selected?.entry && (
        <div className="files__confirm" role="alertdialog" aria-label="Confirmar eliminación">
          <span>¿Eliminar "{selected.entry.name}" de {selected.project.name}{selected.entry.kind === "folder" ? " con todo su contenido" : ""}? Tu copia local no se toca.</span>
          <button type="button" className="ghost-button ghost-button--danger" onClick={() => void remove()}>ELIMINAR</button>
          <button type="button" className="ghost-button" onClick={() => setConfirmDelete(false)}>CANCELAR</button>
        </div>
      )}

      <div className="tree tree--remote">
        <ul>
          {creating !== null && (
            <li>
              <div className="tree__row tree__row--editing">
                <span className="tree__icon" aria-hidden="true">▣</span>
                <input
                  className="tree__input"
                  autoFocus
                  aria-label="Nombre del proyecto"
                  placeholder="Nombre del proyecto"
                  value={creating}
                  onChange={(event) => setCreating(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createProject();
                    if (event.key === "Escape") setCreating(null);
                  }}
                  onBlur={() => setCreating(null)}
                />
              </div>
            </li>
          )}
          {projects.map((project) => {
            const open = openProjects.has(project.id);
            const tree = trees.get(project.id);
            return (
              <li key={project.id}>
                <button
                  type="button"
                  className={selected?.project.id === project.id && !selected.entry ? "tree__row tree__row--project tree__row--selected" : "tree__row tree__row--project"}
                  onClick={() => void toggleProject(project)}
                >
                  <span className="tree__icon" aria-hidden="true">{open ? "▾" : "▸"}</span>
                  <span className="tree__name">▣ {project.name}</span>
                  {inUse(project, "") && <span className="tree__badge">EN USO</span>}
                </button>
                {open && (
                  !tree ? <p className="files__hint tree__loading">Cargando…</p>
                    : tree.isEmpty ? <p className="files__hint tree__loading">Vacío. Sube archivos desde LOCAL.</p>
                    : <ul>{entries(project, tree, null, 1)}</ul>
                )}
              </li>
            );
          })}
          {!projects.length && creating === null && <li><p className="files__hint tree__loading">Todavía no tienes proyectos. Crea uno con + PROYECTO.</p></li>}
        </ul>
      </div>

      {notice && <p className={notice.error ? "files__notice files__notice--error" : "files__notice"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    </div>
  );
}
