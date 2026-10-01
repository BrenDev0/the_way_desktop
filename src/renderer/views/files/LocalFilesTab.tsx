import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactElement } from "react";
import type { ProjectRef } from "../../../core/tools/ports";
import type { LocalEntry } from "../../../core/workspace/localFiles";
import type { ViewRequest } from "./FileChips";
import { errorText, formatSize, nameOf, parentOf, pipe, plural, type Notice } from "./helpers";

interface Props {
  folder: string | null;
  projects: ProjectRef[];
  /** The project open in the other tab, offered first as the upload target. */
  defaultProject: ProjectRef | null;
  /** Bumped when something else (the agent, a download) may have changed the folder. */
  refreshKey: number;
  onChooseFolder(): void;
  /** Where "Descargar" in the project tab should write: the selected folder here. */
  onTargetChange(folder: string): void;
  onUploaded(project: ProjectRef): void;
  /** Opens a file in the viewer. */
  onView?(request: ViewRequest): void;
}

type Editing = { mode: "rename"; path: string; value: string } | { mode: "create"; parent: string; value: string } | null;

const DRAG_TYPE = "application/x-theway-path";

/** The open folder as a tree. Everything happens here first; the server only sees what is uploaded. */
export function LocalFilesTab({ folder, projects, defaultProject, refreshKey, onChooseFolder, onTargetChange, onUploaded, onView }: Props) {
  const [children, setChildren] = useState<Map<string, LocalEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<LocalEntry | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProject, setUploadProject] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Enter commits, and the input then loses focus and would commit again; this makes it once.
  const committed = useRef(false);

  const load = useCallback(async (path: string) => {
    const entries = await window.desktop.files.list(path);
    setChildren((current) => new Map(current).set(path, entries));
  }, []);

  // A new folder starts closed; a refresh reloads every open folder and drops the ones that are gone.
  const reload = useCallback(async (open: Set<string>) => {
    const next = new Map<string, LocalEntry[]>();
    const still = new Set<string>();
    for (const path of ["", ...[...open].sort()]) {
      if (path && !still.has(parentOf(path)) && parentOf(path) !== "") continue;
      try {
        next.set(path, await window.desktop.files.list(path));
        if (path) still.add(path);
      } catch {
        // a folder removed since it was opened simply closes
      }
    }
    setChildren(next);
    setExpanded(still);
  }, []);

  useEffect(() => {
    setSelected(null);
    setEditing(null);
    setNotice(null);
    if (!folder) {
      setChildren(new Map());
      setExpanded(new Set());
      return;
    }
    void reload(new Set()).catch((error) => setNotice({ error: true, text: errorText(error) }));
  }, [folder, reload]);

  useEffect(() => {
    if (folder && refreshKey) void reload(expanded).catch(() => {});
    // expanded is read, not watched: a refresh keeps whatever is open at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    onTargetChange(selected ? (selected.isDirectory ? selected.path : parentOf(selected.path)) : "");
  }, [selected, onTargetChange]);

  useEffect(() => {
    if (!uploadProject && (defaultProject ?? projects[0])) setUploadProject((defaultProject ?? projects[0]).name);
  }, [defaultProject, projects, uploadProject]);

  async function act(run: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await run();
      if (success) setNotice({ error: false, text: success });
    } catch (error) {
      setNotice({ error: true, text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(entry: LocalEntry) {
    const open = new Set(expanded);
    if (open.has(entry.path)) open.delete(entry.path);
    else {
      open.add(entry.path);
      if (!children.has(entry.path)) await act(() => load(entry.path));
    }
    setExpanded(open);
  }

  function startCreate() {
    const parent = selected ? (selected.isDirectory ? selected.path : parentOf(selected.path)) : "";
    if (parent) setExpanded((open) => new Set(open).add(parent));
    beginEdit({ mode: "create", parent, value: "" });
    setConfirmDelete(false);
  }

  function beginEdit(next: Editing) {
    committed.current = false;
    setEditing(next);
  }

  async function commitEdit() {
    if (!editing || committed.current) return;
    committed.current = true;
    const current = editing;
    setEditing(null);
    if (!current.value.trim()) return;
    await act(async () => {
      if (current.mode === "create") {
        await window.desktop.files.createFolder(current.parent, current.value);
        await load(current.parent);
      } else if (current.value.trim() !== nameOf(current.path)) {
        await window.desktop.files.rename(current.path, current.value);
        await reload(expanded);
        setSelected(null);
      }
    });
  }

  async function remove() {
    if (!selected) return;
    const target = selected;
    setConfirmDelete(false);
    await act(async () => {
      await window.desktop.files.remove(target.path);
      setSelected(null);
      await reload(expanded);
    }, `${target.isDirectory ? "Carpeta" : "Archivo"} "${target.name}" eliminado.`);
  }

  async function moveInto(path: string, folderPath: string) {
    if (path === folderPath || parentOf(path) === folderPath || folderPath.startsWith(`${path}/`)) return;
    await act(async () => {
      await window.desktop.files.move(path, folderPath);
      setSelected(null);
      await reload(new Set(expanded).add(folderPath));
    });
  }

  async function upload() {
    if (!uploadProject) return;
    const localPath = selected?.path ?? "";
    setUploading(true);
    setNotice(null);
    try {
      const result = await window.desktop.projects.upload(localPath, uploadProject, destination.trim());
      const skipped = result.skipped.length ? ` ${plural(result.skipped.length, "ya existía y se omitió", "ya existían y se omitieron")}.` : "";
      setNotice({ error: false, text: `${plural(result.uploaded.length, "archivo subido", "archivos subidos")} a ${result.where}.${skipped}` });
      setUploadOpen(false);
      onUploaded(result.project);
    } catch (error) {
      setNotice({ error: true, text: errorText(error) });
    } finally {
      setUploading(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (editing || !selected) return;
    if (event.key === "F2") {
      event.preventDefault();
      beginEdit({ mode: "rename", path: selected.path, value: selected.name });
    } else if (event.key === "Delete") {
      event.preventDefault();
      setConfirmDelete(true);
    }
  }

  function dragStart(event: DragEvent, entry: LocalEntry) {
    event.dataTransfer.setData(DRAG_TYPE, entry.path);
    event.dataTransfer.effectAllowed = "move";
  }

  function dropProps(folderPath: string) {
    return {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        setDropTarget(folderPath);
      },
      onDragLeave: () => setDropTarget((current) => (current === folderPath ? null : current)),
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(null);
        const path = event.dataTransfer.getData(DRAG_TYPE);
        if (path) void moveInto(path, folderPath);
      },
    };
  }

  function nameInput(value: string, depth: number) {
    return (
      <div className="tree__row tree__row--editing" style={{ paddingLeft: 10 + depth * 14 }}>
        <span className="tree__icon" aria-hidden="true">{editing?.mode === "create" ? "▸" : "◻"}</span>
        <input
          className="tree__input"
          autoFocus
          aria-label={editing?.mode === "create" ? "Nombre de la carpeta nueva" : "Nuevo nombre"}
          value={value}
          onChange={(event) => setEditing((current) => (current ? { ...current, value: event.target.value } : current))}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitEdit();
            if (event.key === "Escape") { committed.current = true; setEditing(null); }
          }}
          onBlur={() => void commitEdit()}
        />
      </div>
    );
  }

  function rows(path: string, depth: number): ReactElement[] {
    const list = children.get(path) ?? [];
    const out: ReactElement[] = [];
    if (editing?.mode === "create" && editing.parent === path) out.push(<li key="__new" {...pipe(depth)}>{nameInput(editing.value, depth)}</li>);
    for (const entry of list) {
      const open = expanded.has(entry.path);
      out.push(
        <li key={entry.path} {...pipe(depth)}>
          {editing?.mode === "rename" && editing.path === entry.path ? nameInput(editing.value, depth) : (
            <button
              type="button"
              className={[
                "tree__row",
                selected?.path === entry.path && "tree__row--selected",
                dropTarget === entry.path && "tree__row--drop",
              ].filter(Boolean).join(" ")}
              style={{ paddingLeft: 10 + depth * 14 }}
              draggable
              onDragStart={(event) => dragStart(event, entry)}
              {...(entry.isDirectory ? dropProps(entry.path) : {})}
              onClick={() => {
                setSelected(entry);
                setConfirmDelete(false);
                if (entry.isDirectory) void toggle(entry);
              }}
              // a file opens; a folder (and F2 or ✎ for anything) renames
              onDoubleClick={() => (!entry.isDirectory && onView
                ? onView({ source: "local", path: entry.path })
                : beginEdit({ mode: "rename", path: entry.path, value: entry.name }))}
              title={entry.path}
            >
              <span className="tree__icon" aria-hidden="true">{entry.isDirectory ? (open ? "▾" : "▸") : "◻"}</span>
              <span className="tree__name">{entry.name}{entry.isDirectory ? "/" : ""}</span>
              {!entry.isDirectory && <span className="tree__meta">{formatSize(entry.size)}</span>}
            </button>
          )}
          {entry.isDirectory && open && <ul>{rows(entry.path, depth + 1)}</ul>}
        </li>,
      );
    }
    return out;
  }

  if (!folder) {
    return (
      <div className="files__empty">
        <p>Elige la carpeta donde trabajarás. Todo se guarda primero en este equipo; tú decides qué subir a un proyecto.</p>
        <button type="button" className="connect-button" onClick={onChooseFolder}>ELEGIR CARPETA <span aria-hidden="true">▣</span></button>
      </div>
    );
  }

  const root = children.get("");
  const target = selected ? `"${selected.name}"` : "toda la carpeta";

  return (
    <div className="files__body" onKeyDown={onKeyDown}>
      <div className="files__toolbar" role="toolbar" aria-label="Acciones de archivos">
        <button type="button" className="ghost-button" onClick={startCreate} disabled={busy}>+ CARPETA</button>
        {onView && (
          <button
            type="button"
            className="ghost-button"
            disabled={!selected || selected.isDirectory}
            onClick={() => selected && !selected.isDirectory && onView({ source: "local", path: selected.path })}
            title="Ver el archivo (o doble clic)"
          >
            ◉ VER
          </button>
        )}
        <button type="button" className="ghost-button ghost-button--icon" disabled={busy || !selected} onClick={() => selected && beginEdit({ mode: "rename", path: selected.path, value: selected.name })} title="Renombrar (F2)" aria-label="Renombrar">✎</button>
        <button type="button" className="ghost-button ghost-button--icon ghost-button--danger" disabled={busy || !selected} onClick={() => setConfirmDelete(true)} title="Eliminar (Supr)" aria-label="Eliminar">✕</button>
        <button type="button" className="ghost-button ghost-button--icon" disabled={busy} onClick={() => void act(() => window.desktop.files.reveal(selected?.path ?? ""))} title="Mostrar en el explorador" aria-label="Mostrar en el explorador">↗</button>
        <button type="button" className="ghost-button ghost-button--icon" disabled={busy} onClick={() => void act(() => reload(expanded))} title="Actualizar" aria-label="Actualizar">↻</button>
      </div>

      {confirmDelete && selected && (
        <div className="files__confirm" role="alertdialog" aria-label="Confirmar eliminación">
          <span>¿Eliminar {selected.isDirectory ? "la carpeta" : "el archivo"} "{selected.name}"{selected.isDirectory ? " y todo su contenido" : ""}? No se puede deshacer.</span>
          <button type="button" className="ghost-button ghost-button--danger" onClick={() => void remove()}>ELIMINAR</button>
          <button type="button" className="ghost-button" onClick={() => setConfirmDelete(false)}>CANCELAR</button>
        </div>
      )}

      <div
        className={dropTarget === "" ? "tree tree--drop" : "tree"}
        {...dropProps("")}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}
      >
        {!root ? <p className="files__hint">Cargando…</p> : !root.length && editing?.mode !== "create" ? (
          <p className="files__hint">La carpeta está vacía. El agente guardará aquí lo que cree.</p>
        ) : <ul>{rows("", 0)}</ul>}
      </div>

      {notice && <p className={notice.error ? "files__notice files__notice--error" : "files__notice"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}

      {uploadOpen ? (
        <form className="files__upload" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
          <span className="files__upload-title">SUBIR {target.toUpperCase()}</span>
          {projects.length ? (
            <>
              <label>PROYECTO
                <select value={uploadProject} onChange={(event) => setUploadProject(event.target.value)} disabled={uploading}>
                  {projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}
                </select>
              </label>
              <label>CARPETA EN EL PROYECTO
                <input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="raíz del proyecto" disabled={uploading} spellCheck={false} />
              </label>
              <p className="files__hint">Los archivos que ya estén en el proyecto se omiten, nunca se reemplazan.</p>
              <div className="files__upload-actions">
                <button type="button" className="ghost-button" onClick={() => setUploadOpen(false)} disabled={uploading}>CANCELAR</button>
                <button type="submit" className="connect-button" disabled={uploading || !uploadProject}>{uploading ? "SUBIENDO…" : "SUBIR"} <span aria-hidden="true">↑</span></button>
              </div>
            </>
          ) : (
            <p className="files__hint">Todavía no tienes proyectos. Crea uno en la lista de la izquierda.</p>
          )}
        </form>
      ) : (
        <button type="button" className="connect-button files__upload-open" onClick={() => setUploadOpen(true)} disabled={busy || uploading}>
          ↑ SUBIR A PROYECTO <span className="files__upload-target">{target}</span>
        </button>
      )}
    </div>
  );
}
