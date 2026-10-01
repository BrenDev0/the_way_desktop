import { useCallback, useState } from "react";
import type { ProjectRef } from "../../../core/tools/ports";
import type { ViewRequest } from "./FileChips";
import { LocalFilesTab } from "./LocalFilesTab";
import { RemoteFilesTab, type RemoteFocus } from "./RemoteFilesTab";
import "./files.css";

export type FilesTab = "local" | "remote";

interface Props {
  folder: string | null;
  projects: ProjectRef[];
  tab: FilesTab;
  /** Bumped by the workbench when an agent turn ends: it may have written to the folder. */
  localRefresh: number;
  /** Bumped when an agent turn ends: it may have added files to projects on the server. */
  serverRefresh: number;
  /** A project folder to show in the remote tree (a task's delivery). */
  focus: RemoteFocus | null;
  onTab(tab: FilesTab): void;
  onChooseFolder(): void;
  onProjectsChanged(): Promise<void>;
  /** Opens a file in the viewer. */
  onView?(request: ViewRequest): void;
  /** The project folder the agent works in now, when it works on the server. */
  workingRemote?: { project: string; path: string } | null;
  /** Makes a project ("" path) or a folder in one where the agent works. */
  onWorkHere?(project: string, path: string): Promise<void>;
  /** Shown only when the panel can be dismissed (as an overlay in a small window). */
  onClose?(): void;
}

/** One file tree with a switch: the operator's folder, or their projects on the server. */
export function FilesPanel({ folder, projects, tab, localRefresh, serverRefresh, focus, onTab, onChooseFolder, onProjectsChanged, onView, workingRemote, onWorkHere, onClose }: Props) {
  const [localTarget, setLocalTarget] = useState("");
  const [downloads, setDownloads] = useState(0);
  const [uploads, setUploads] = useState(0);
  const onTargetChange = useCallback((path: string) => setLocalTarget(path), []);
  const remote = tab === "remote";

  return (
    <aside className="files" aria-label="Archivos">
      <header className="files__switchbar">
        <button
          type="button"
          role="switch"
          aria-checked={remote}
          aria-label={remote ? "Mostrando el servidor. Cambiar a este equipo" : "Mostrando este equipo. Cambiar al servidor"}
          className="files__switch"
          onClick={() => onTab(remote ? "local" : "remote")}
        >
          <span className={remote ? "files__side" : "files__side files__side--on"}>LOCAL</span>
          <span className="files__swap" aria-hidden="true">⇄</span>
          <span className={remote ? "files__side files__side--on" : "files__side"}>REMOTO</span>
        </button>
        {onClose && <button type="button" className="files__close" onClick={onClose} aria-label="Ocultar archivos" title="Ocultar archivos">×</button>}
      </header>

      {/* Both stay mounted so switching keeps each tree as it was left. */}
      <div className="files__pane" hidden={remote}>
        <LocalFilesTab
          folder={folder}
          projects={projects}
          defaultProject={focus ? projects.find((p) => p.name === focus.project) ?? null : null}
          refreshKey={localRefresh + downloads}
          onChooseFolder={onChooseFolder}
          onTargetChange={onTargetChange}
          onUploaded={() => setUploads((n) => n + 1)}
          onView={onView}
        />
      </div>
      <div className="files__pane" hidden={!remote}>
        <RemoteFilesTab
          projects={projects}
          folder={folder}
          localTarget={localTarget}
          refreshKey={uploads + serverRefresh}
          focus={focus}
          onProjectsChanged={onProjectsChanged}
          onDownloaded={() => setDownloads((n) => n + 1)}
          onView={onView}
          workingRemote={workingRemote ?? null}
          onWorkHere={onWorkHere}
        />
      </div>
    </aside>
  );
}
