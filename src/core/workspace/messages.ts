/**
 * What the operator reads when a files-panel action fails. Server errors carry a code;
 * the tools' own errors are written for the agent, in English, so the ones the panel
 * can meet are said again here.
 */

import { ApiError } from "../api";
import { MAX_UPLOAD_FILES, UploadLimitError } from "../tools/transfer";
import { BY_CODE, FriendlyError, failureText } from "../userMessages";
import { LocalFilesError } from "./localFiles";

export function operatorMessage(error: unknown): string {
  if (error instanceof FriendlyError || error instanceof LocalFilesError) return error.message;
  if (error instanceof UploadLimitError) {
    return error.limit === "files"
      ? `Son ${error.amount} archivos; el máximo por subida es ${MAX_UPLOAD_FILES}. Sube una carpeta más pequeña.`
      : `Son ${Math.round(error.amount / 1048576)} MB; el máximo por subida es 512 MB.`;
  }
  if (error instanceof ApiError) return failureText(error);

  const text = error instanceof Error ? error.message : String(error);
  if (text.startsWith("No folder is open")) return "Elige primero una carpeta de trabajo.";
  if (text.includes("outside the open folder")) return "Esa ruta queda fuera de la carpeta de trabajo.";
  if (text.includes("already exists on the computer")) return "Ya existe un archivo con ese nombre en esta carpeta.";
  if (text.includes("refused the upload") || text.includes("refused the download")) {
    return "El almacenamiento rechazó la transferencia. Inténtalo de nuevo.";
  }
  // the viewer finding a file by the agent's own words for it
  if (text.startsWith("No project named")) return BY_CODE.project_not_found;
  if (text.startsWith("Nothing named")) return "Ese archivo ya no está en el proyecto: puede que se haya movido o eliminado.";
  if (text.includes("has not finished uploading")) return BY_CODE.file_not_uploaded;
  if (text.includes("is a folder, not a file")) return "Eso es una carpeta, no un archivo.";
  return "No se pudo completar la acción.";
}
