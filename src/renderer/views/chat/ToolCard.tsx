import type { ToolActivity } from "../../../core/conversations/transcript";

/** Where a tool acts, so "created a folder" says whether it was on this computer or the server. */
type Place = "equipo" | "proyecto" | "web" | "navegador" | "agente";

const TOOLS: Record<string, [label: string, place: Place]> = {
  ReadFile: ["Leer archivo", "equipo"],
  ListDir: ["Listar carpeta", "equipo"],
  SearchFile: ["Buscar archivos", "equipo"],
  SearchCode: ["Buscar en archivos", "equipo"],
  CreateDir: ["Crear carpeta", "equipo"],
  CreateFile: ["Crear archivo", "equipo"],
  UpdateFile: ["Modificar archivo", "equipo"],
  CopyPath: ["Copiar", "equipo"],
  MovePath: ["Mover o renombrar", "equipo"],
  DeleteFile: ["Eliminar archivo", "equipo"],
  DeleteDir: ["Eliminar carpeta", "equipo"],
  UploadToProject: ["Subir al proyecto", "proyecto"],
  DownloadFromProject: ["Descargar del proyecto", "equipo"],
  ListProjects: ["Ver proyectos", "proyecto"],
  CreateProject: ["Crear proyecto", "proyecto"],
  ListProjectFolder: ["Listar carpeta del proyecto", "proyecto"],
  FindProjectFiles: ["Buscar en el proyecto", "proyecto"],
  ReadProjectFile: ["Leer archivo del proyecto", "proyecto"],
  WriteProjectFile: ["Escribir archivo del proyecto", "proyecto"],
  EditProjectFile: ["Modificar archivo del proyecto", "proyecto"],
  CreateProjectFolder: ["Crear carpeta en el proyecto", "proyecto"],
  CopyProjectPath: ["Copiar en el proyecto", "proyecto"],
  MoveProjectPath: ["Mover en el proyecto", "proyecto"],
  DeleteProjectPath: ["Eliminar del proyecto", "proyecto"],
  BuildHtmlPage: ["Crear página HTML", "proyecto"],
  StartBackgroundTask: ["Iniciar tarea en segundo plano", "agente"],
  CheckBackgroundTask: ["Revisar tarea en segundo plano", "agente"],
  DeliverTask: ["Entregar tarea", "proyecto"],
  WebSearch: ["Buscar en la web", "web"],
  ExtractWebPages: ["Leer páginas web", "web"],
  MapWebPages: ["Explorar sitio web", "web"],
  CrawlWebPages: ["Recorrer sitio web", "web"],
  OpenBrowserPage: ["Abrir página", "navegador"],
  ReadBrowserPage: ["Leer página", "navegador"],
  ClickBrowserElement: ["Hacer clic", "navegador"],
  TypeInBrowser: ["Escribir en el navegador", "navegador"],
  ListBrowserTabs: ["Ver pestañas", "navegador"],
  SwitchBrowserTab: ["Cambiar de pestaña", "navegador"],
  CloseBrowser: ["Cerrar navegador", "navegador"],
  FindWhatsappChat: ["Buscar chat de WhatsApp", "navegador"],
  ReadWhatsappChat: ["Leer chat de WhatsApp", "navegador"],
  SendWhatsappMessage: ["Enviar mensaje de WhatsApp", "navegador"],
  ReadSkill: ["Consultar skill", "agente"],
  SaveSkill: ["Guardar skill", "agente"],
  BuildSkill: ["Crear skill", "agente"],
  ReadKnowledgeDocument: ["Consultar conocimiento", "agente"],
  RememberPreference: ["Recordar preferencia", "agente"],
};

const PLACES: Record<Place, string> = {
  equipo: "ESTE EQUIPO",
  proyecto: "PROYECTO EN EL SERVIDOR",
  web: "WEB",
  navegador: "NAVEGADOR",
  agente: "AGENTE",
};

// The argument that says what a call was about, in the order worth showing.
// Local tool names come from src/core/tools/*.ts; project and web ones from the server's tool schemas.
const KEYS = ["name", "project", "path", "file_path", "dir_path", "file_name", "folder_path", "local_path", "destination_path", "destination", "output_path", "source", "to", "target", "url", "query", "pattern", "match", "chat", "description", "task_id"];

function detail(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim() && !parts.includes(value)) parts.push(value.trim());
    if (parts.length === 2) break;
  }
  return parts.join(" · ");
}

export function ToolCard({ tool, waiting }: { tool: ToolActivity; waiting: boolean }) {
  const [label, place] = TOOLS[tool.name] ?? [tool.name, "agente"];
  const about = detail(tool.args);
  const state = tool.result !== null ? "done" : waiting ? "running" : "pending";

  return (
    <details className={`tool tool--${state} tool--${place}`}>
      <summary>
        <span className="tool__state" aria-hidden="true">{state === "done" ? "✓" : state === "running" ? "…" : "○"}</span>
        <span className="tool__label">{label}</span>
        <span className="tool__place">{PLACES[place]}</span>
        {about && <span className="tool__about selectable" title={about}>{about}</span>}
      </summary>
      <pre className="tool__result selectable">{tool.result ?? (waiting ? "En curso…" : "Sin respuesta todavía.")}</pre>
    </details>
  );
}
