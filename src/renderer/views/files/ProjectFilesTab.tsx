import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import type { ProjectRef, RemoteTree } from "../../../core/tools/ports";
import { ProjectTree, type RemoteEntry } from "../../../core/workspace/remoteTree";
import { errorText, formatSize, plural, type Notice } from "./helpers";

interface Props {
  project: ProjectRef | null;
  folder: string | null;
  /** The local folder a download writes into (the one selected in the local tab). */
  localTarget: string;
  /** Bumped after an upload into this project. */
  refreshKey: number;
  onDownloaded(): void;
}

/** One project on the server: browse it, bring files down, tidy it up. */
export function ProjectFilesTab({ project, folder, localTarget, refreshKey, onDownloaded }: Props) {
  const [tree, setTree] = useState<RemoteTree | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<RemoteEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const view = useMemo(() => (tree ? new ProjectTree(tree) : null), [tree]);

  const load = useCallback(async () => {
    if (!project) return;
    setTree(await window.desktop.projects.tree(project.id));
  }, [project]);

  useEffect(() => {
    setTree(null);
    setSelected(null);
    setExpanded(new Set());
    setNotice(null);
    void load().catch((error) => setNotice({ error: true, text: errorText(error) }));
  }, [load]);

  useEffect(() => {
    if (refreshKey) void load().catch(() => {});
  }, [refreshKey, load]);

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

  async function download() {
    if (!project) return;
    const path = selected?.path ?? "";
    await act(async () => {
      const result = await window.desktop.projects.download(project.name, path, localTarget);
      setNotice({ error: false, text: `${plural(result.written.length, "archivo descargado", "archivos descargados")} en ${localTarget || "la carpeta de trabajo"}.` });
      onDownloaded();
    });
  }

  async function remove() {
    if (!project || !selected) return;
    const target = selected;
    setConfirmDelete(false);
    await act(async () => {
      await window.desktop.projects.removeEntry(project.id, target.kind, target.id);
      setSelected(null);
      await load();
      setNotice({ error: false, text: `"${target.name}" eliminado del proyecto.` });
    });
  }

  function rows(parentId: string | null, depth: number): ReactElement[] {
    if (!view) return [];
    return view.children(parentId).map((entry) => {
      const open = entry.kind === "folder" && expanded.has(entry.id);
      const pending = entry.kind === "file" && entry.file.status !== "ready";
      return (
        <li key={entry.id}>
          <button
            type="button"
            className={selected?.id === entry.id ? "tree__row tree__row--selected" : "tree__row"}
            style={{ paddingLeft: 10 + depth * 14 }}
            title={entry.path}
            onClick={() => {
              setSelected(entry);
              setConfirmDelete(false);
              if (entry.kind === "folder") {
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(entry.id)) next.delete(entry.id);
                  else next.add(entry.id);
                  return next;
                });
              }
            }}
          >
            <span className="tree__icon" aria-hidden="true">{entry.kind === "folder" ? (open ? "▾" : "▸") : "◻"}</span>
            <span className="tree__name">{entry.name}{entry.kind === "folder" ? "/" : ""}</span>
            {entry.kind === "file" && <span className="tree__meta">{pending ? "subiendo…" : formatSize(entry.file.sizeBytes)}</span>}
          </button>
          {open && <ul>{rows(entry.id, depth + 1)}</ul>}
        </li>
      );
    });
  }

  if (!project) {
    return <div className="files__empty"><p>Elige un proyecto en la lista de la izquierda para ver sus archivos en el servidor.</p></div>;
  }

  const what = selected ? `"${selected.name}"` : "todo el proyecto";

  return (
    <div className="files__body">
      <div className="files__toolbar" role="toolbar" aria-label="Acciones del proyecto">
        <button type="button" className="ghost-button" disabled={busy || !folder || !tree} onClick={() => void download()} title={folder ? undefined : "Elige primero una carpeta de trabajo"}>
          ↓ DESCARGAR
        </button>
        <button type="button" className="ghost-button ghost-button--danger" disabled={busy || !selected} onClick={() => setConfirmDelete(true)}>ELIMINAR</button>
        <button type="button" className="ghost-button ghost-button--icon" disabled={busy} onClick={() => void act(load)} title="Actualizar" aria-label="Actualizar">↻</button>
      </div>
      <p className="files__hint">
        Descargar {what} en <span className="selectable">{localTarget || "la carpeta de trabajo"}</span>. Si un archivo ya existe en este equipo, la descarga se detiene sin reemplazarlo.
      </p>

      {confirmDelete && selected && (
        <div className="files__confirm" role="alertdialog" aria-label="Confirmar eliminación">
          <span>¿Eliminar "{selected.name}" del proyecto{selected.kind === "folder" ? " con todo su contenido" : ""}? Tu copia local no se toca.</span>
          <button type="button" className="ghost-button ghost-button--danger" onClick={() => void remove()}>ELIMINAR</button>
          <button type="button" className="ghost-button" onClick={() => setConfirmDelete(false)}>CANCELAR</button>
        </div>
      )}

      <div className="tree" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        {!view ? <p className="files__hint">Cargando…</p> : view.isEmpty ? (
          <p className="files__hint">Este proyecto está vacío. Sube archivos desde la pestaña Local.</p>
        ) : <ul>{rows(null, 0)}</ul>}
      </div>

      {notice && <p className={notice.error ? "files__notice files__notice--error" : "files__notice"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    </div>
  );
}
