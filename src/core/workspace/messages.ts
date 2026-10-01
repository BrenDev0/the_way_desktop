/**
 * What the operator reads when a files-panel action fails. Server errors carry a code;
 * the tools' own errors are written for the agent, in English, so the ones the panel
 * can meet are said again here.
 */

import { ApiError } from "../api";
import { MAX_UPLOAD_FILES, UploadLimitError } from "../tools/transfer";
import { LocalFilesError } from "./localFiles";

const SERVER: Record<string, string> = {
  unreachable: "No se pudo conectar con el servidor.",
  not_connected: "No hay un servidor conectado.",
  project_not_found: "Ese proyecto ya no existe.",
  folder_not_found: "Esa carpeta del proyecto ya no existe. Actualiza la lista.",
  file_not_found: "Ese archivo del proyecto ya no existe. Actualiza la lista.",
  file_not_uploaded: "Ese archivo todavía se está subiendo.",
  project_name_invalid: 'Ese nombre no es válido: evita < > : " / \\ | ? * y los puntos al final.',
  project_name_taken: "Ya tienes un proyecto con ese nombre.",
  project_entry_name_taken: "Ya hay un archivo o carpeta con ese nombre en el proyecto.",
  file_too_large: "El archivo supera los 5 GB que admite un proyecto.",
  project_storage_unavailable: "El almacenamiento de proyectos no está disponible. Inténtalo más tarde.",
  file_content_missing:
    "Este archivo aparece en el proyecto, pero su contenido ya no está en el almacenamiento. Vuelve a generarlo o elimina la entrada.",
  file_too_large_to_open: "Este archivo es demasiado grande para abrirlo aquí. Descárgalo desde el panel de archivos.",
};

export function operatorMessage(error: unknown): string {
  if (error instanceof LocalFilesError) return error.message;
  if (error instanceof UploadLimitError) {
    return error.limit === "files"
      ? `Son ${error.amount} archivos; el máximo por subida es ${MAX_UPLOAD_FILES}. Sube una carpeta más pequeña.`
      : `Son ${Math.round(error.amount / 1048576)} MB; el máximo por subida es 512 MB.`;
  }
  if (error instanceof ApiError) return SERVER[error.code] ?? "El servidor no pudo completar la acción.";

  const text = error instanceof Error ? error.message : String(error);
  if (text.startsWith("No folder is open")) return "Elige primero una carpeta de trabajo.";
  if (text.includes("outside the open folder")) return "Esa ruta queda fuera de la carpeta de trabajo.";
  if (text.includes("already exists on the computer")) return "Ya existe un archivo con ese nombre en esta carpeta.";
  if (text.includes("refused the upload") || text.includes("refused the download")) {
    return "El almacenamiento rechazó la transferencia. Inténtalo de nuevo.";
  }
  // the viewer finding a file by the agent's own words for it
  if (text.startsWith("No project named")) return SERVER.project_not_found;
  if (text.startsWith("Nothing named")) return "Ese archivo ya no está en el proyecto: puede que se haya movido o eliminado.";
  if (text.includes("has not finished uploading")) return SERVER.file_not_uploaded;
  if (text.includes("is a folder, not a file")) return "Eso es una carpeta, no un archivo.";
  return "No se pudo completar la acción.";
}
