import { ApiError } from "../api";

const TEXTS: Record<string, string> = {
  folder_name_taken: "Ya tienes una carpeta con ese nombre.",
  folder_name_required: "La carpeta necesita un nombre.",
  folder_name_too_long: "El nombre de la carpeta puede tener hasta 60 caracteres.",
  conversation_folder_limit_reached: "Puedes tener hasta 50 carpetas: elimina una antes de crear otra.",
  conversation_folder_not_found: "Esa carpeta ya no existe.",
  conversation_not_found: "Esa conversación ya no existe.",
};

/** What a failed folder call says to the person, in their words: the server's reason by its
 *  code, since the window only ever gets the message. Anything else goes up as it was. */
export function folderError(error: unknown): Error {
  if (error instanceof ApiError && TEXTS[error.code]) return new Error(TEXTS[error.code]);
  return error instanceof Error ? error : new Error(String(error));
}
