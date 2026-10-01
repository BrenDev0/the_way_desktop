/** How tool calls read to the operator: shared by the chat's cards and the tasks column. */

/** Where a tool acts, so "created a folder" says whether it was on this computer or the server. */
export type Place = "equipo" | "proyecto" | "web" | "navegador" | "agente";

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
  RenamePath: ["Renombrar", "equipo"],
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
  RenameProjectPath: ["Renombrar en el proyecto", "proyecto"],
  DeleteProjectPath: ["Eliminar del proyecto", "proyecto"],
  BuildHtmlPage: ["Crear página HTML", "proyecto"],
  HtmlToPdf: ["Convertir a PDF", "proyecto"],
  ReadPdf: ["Leer PDF", "proyecto"],
  EditPdfPages: ["Editar páginas del PDF", "proyecto"],
  MergePdfs: ["Unir PDFs", "proyecto"],
  PdfToImages: ["PDF a imágenes", "proyecto"],
  ImagesToPdf: ["Imágenes a PDF", "proyecto"],
  InspectImage: ["Ver detalles de imagen", "proyecto"],
  TransformImage: ["Ajustar imagen", "proyecto"],
  AddTextToImage: ["Poner texto en imagen", "proyecto"],
  OverlayImage: ["Superponer imagen", "proyecto"],
  GenerateImages: ["Generar imágenes", "proyecto"],
  EditImage: ["Editar imagen", "proyecto"],
  HtmlToPng: ["Convertir a imagen PNG", "proyecto"],
  StartBackgroundTask: ["Iniciar tarea en segundo plano", "agente"],
  CheckBackgroundTask: ["Revisar tarea en segundo plano", "agente"],
  DeliverTask: ["Entregar tarea", "proyecto"],
  WebSearch: ["Buscar en la web", "web"],
  ExtractWebPages: ["Leer páginas web", "web"],
  MapWebPages: ["Explorar sitio web", "web"],
  CrawlWebPages: ["Recorrer sitio web", "web"],
  WebResearch: ["Investigar en la web", "web"],
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

export const PLACES: Record<Place, string> = {
  equipo: "ESTE EQUIPO",
  proyecto: "PROYECTO EN EL SERVIDOR",
  web: "WEB",
  navegador: "NAVEGADOR",
  agente: "AGENTE",
};

// The argument that says what a call was about, in the order worth showing.
// Local tool names come from src/core/tools/*.ts; project and web ones from the server's tool schemas.
const KEYS = ["name", "project", "path", "file_path", "dir_path", "file_name", "folder_path", "local_path", "destination_path", "destination", "output_path", "source", "to", "target", "url", "query", "pattern", "match", "chat", "description", "task_id"];

export function detail(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim() && !parts.includes(value)) parts.push(value.trim());
    if (parts.length === 2) break;
  }
  return parts.join(" · ");
}

/** Spanish label and where it acts; an unknown tool (newer server) keeps its own name. */
export function toolInfo(name: string): [label: string, place: Place] {
  return TOOLS[name] ?? [name, "agente"];
}
