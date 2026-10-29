/**
 * What the person reads when something fails, in Spanish. The server's own messages are for
 * whoever reads logs, in English; nothing of them reaches the screen. A failure is said by its
 * code (a table, here), and when the code is not known, by what kind of failure it was (its
 * HTTP status). The window never sees the original: it stays in the console of the main process.
 */

import { ApiError } from "./api";

/** An error whose message is already written for the person. Only the message crosses to the window. */
export class FriendlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendlyError";
  }
}

export const GENERIC = "No se pudo completar la acción. Inténtalo de nuevo.";

/** The server's error codes the app can meet, each said once. */
export const BY_CODE: Record<string, string> = {
  // the connection and the session
  unreachable: "No se pudo conectar con el servidor.",
  not_connected: "No hay un servidor conectado.",
  not_authenticated: "Tu sesión terminó. Inicia sesión de nuevo.",
  invalid_session: "Tu sesión terminó. Inicia sesión de nuevo.",
  missing_session: "Tu sesión terminó. Inicia sesión de nuevo.",
  invalid_credentials: "Correo o contraseña incorrectos.",
  login_rate_limited: "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.",
  insufficient_role: "No tienes permiso para hacer esto.",

  // the conversation
  api_key_not_configured: "El acceso a la IA de tu organización todavía no está habilitado. Escribe a Xplorers para activarlo.",
  conversation_busy: "AGENTIX sigue trabajando en el mensaje anterior.",
  conversation_not_found: "Esa conversación ya no existe.",
  message_empty: "Escribe un mensaje antes de enviarlo.",
  attachment_too_large: "Ese archivo es demasiado grande para adjuntarlo.",

  // the person's folders for their chats
  folder_name_taken: "Ya tienes una carpeta con ese nombre.",
  folder_name_required: "La carpeta necesita un nombre.",
  folder_name_too_long: "El nombre de la carpeta puede tener hasta 60 caracteres.",
  conversation_folder_limit_reached: "Puedes tener hasta 50 carpetas: elimina una antes de crear otra.",
  conversation_folder_not_found: "Esa carpeta ya no existe.",

  // background tasks
  background_task_not_found: "Esa tarea ya no existe.",
  task_not_running: "Esa tarea ya no está en marcha.",
  task_not_stopped: "Esa tarea no está detenida.",
  task_approval_expired: "La tarea esperó tu respuesta demasiado tiempo y se detuvo.",

  // updating the app
  installer_not_published: "Todavía no hay un instalador publicado para actualizar. Inténtalo más tarde.",
  downloads_unavailable: "Las descargas no están disponibles en este momento. Inténtalo de nuevo en unos minutos.",

  // voice
  voice_key_not_configured: "La voz necesita una clave de OpenAI y tu organización aún no la tiene. Escribe a Xplorers para activarla.",
  voice_key_rejected: "La clave de OpenAI de tu organización fue rechazada. Escribe a Xplorers para que la reemplacen.",
  voice_audio_too_large: "La grabación es demasiado larga.",
  voice_unavailable: "La voz no está disponible en este momento.",

  // projects and their files
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

/** When the code is not one of those: what kind of failure it was. */
function byStatus(status: number): string {
  if (status === 0) return BY_CODE.unreachable;
  if (status === 401) return BY_CODE.invalid_session;
  if (status === 403) return BY_CODE.insufficient_role;
  if (status === 404) return "Eso ya no existe. Actualiza e inténtalo de nuevo.";
  if (status === 409) return "Eso cambió mientras lo hacías. Actualiza e inténtalo de nuevo.";
  if (status === 413) return "Es demasiado grande.";
  if (status === 422) return "Algún dato no es válido. Revísalo e inténtalo de nuevo.";
  if (status === 429) return "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.";
  if (status >= 500) return "El servidor tuvo un problema. Inténtalo de nuevo en un momento.";
  return GENERIC;
}

export function failureText(error: ApiError): string {
  return BY_CODE[error.code] ?? byStatus(error.status);
}

/**
 * Any failure, said to the person: what we already wrote for them as it is, a server failure by
 * its code or its kind, and anything else -- a bug, a refused path, a library's message -- not at all.
 */
export function friendly(error: unknown): string {
  if (error instanceof FriendlyError) return error.message;
  if (error instanceof ApiError) return failureText(error);
  return GENERIC;
}
