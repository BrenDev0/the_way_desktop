import { useCallback, useState } from "react";
import type { ProjectRef } from "../../../core/tools/ports";
import { LocalFilesTab } from "./LocalFilesTab";
import { ProjectFilesTab } from "./ProjectFilesTab";
import "./files.css";

export type FilesTab = "local" | "project";

interface Props {
  folder: string | null;
  projects: ProjectRef[];
  project: ProjectRef | null;
  tab: FilesTab;
  /** Bumped by the workbench when an agent turn ends: it may have written to the folder. */
  localRefresh: number;
  /** Bumped when an agent turn ends: it may have added files to the open project on the server. */
  serverRefresh: number;
  onTab(tab: FilesTab): void;
  onChooseFolder(): void;
  onClose(): void;
}

/** The right-hand panel: the operator's folder first, the project on the server second. */
export function FilesPanel({ folder, projects, project, tab, localRefresh, serverRefresh, onTab, onChooseFolder, onClose }: Props) {
  const [localTarget, setLocalTarget] = useState("");
  const [downloads, setDownloads] = useState(0);
  const [uploads, setUploads] = useState(0);
  const onTargetChange = useCallback((path: string) => setLocalTarget(path), []);

  return (
    <aside className="files" aria-label="Archivos">
      <header className="files__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "local"} className={tab === "local" ? "files__tab files__tab--active" : "files__tab"} onClick={() => onTab("local")}>
          LOCAL
        </button>
        <button type="button" role="tab" aria-selected={tab === "project"} className={tab === "project" ? "files__tab files__tab--active" : "files__tab"} onClick={() => onTab("project")}>
          {project ? `PROYECTO · ${project.name}` : "PROYECTO"}
        </button>
        <button type="button" className="files__close" onClick={onClose} aria-label="Ocultar archivos" title="Ocultar archivos">×</button>
      </header>

      {/* Both stay mounted so switching tabs keeps each tree as it was left. */}
      <div className="files__pane" hidden={tab !== "local"}>
        <LocalFilesTab
          folder={folder}
          projects={projects}
          defaultProject={project}
          refreshKey={localRefresh + downloads}
          onChooseFolder={onChooseFolder}
          onTargetChange={onTargetChange}
          onUploaded={() => setUploads((n) => n + 1)}
        />
      </div>
      <div className="files__pane" hidden={tab !== "project"}>
        <ProjectFilesTab
          project={project}
          folder={folder}
          localTarget={localTarget}
          refreshKey={uploads + serverRefresh}
          onDownloaded={() => setDownloads((n) => n + 1)}
        />
      </div>
    </aside>
  );
}
