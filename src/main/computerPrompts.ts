import { dialog, type BrowserWindow, type MessageBoxOptions, type OpenDialogOptions } from "electron";
import type { AccessChoice, ComputerPrompts } from "./nodeComputer";

export function computerPrompts(window: () => BrowserWindow | null): ComputerPrompts {
  const pickFolder = async (message: string): Promise<string | null> => {
    const options: OpenDialogOptions = {
      title: "Dar acceso de solo lectura a una carpeta",
      message,
      buttonLabel: "Dar acceso",
      properties: ["openDirectory"],
    };
    const parent = window();
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return picked.canceled ? null : picked.filePaths[0] ?? null;
  };

  return {
    folder: () =>
      pickFolder("AGENTIX podrá leer, nunca modificar, lo que haya en la carpeta que elijas; lo que lea se envía al servidor y al proveedor de IA."),

    async ask(reason): Promise<AccessChoice | null> {
      const options: MessageBoxOptions = {
        type: "question",
        title: "AGENTIX quiere buscar en tu equipo",
        message: reason || "AGENTIX quiere buscar un archivo en tu equipo.",
        detail:
          "Si permites la búsqueda, podrá buscar y leer (nunca modificar) los archivos de tu carpeta de usuario: " +
          "Escritorio, Documentos, Descargas, OneDrive... No verá contraseñas, claves ni archivos de programas. " +
          "Lo que lea se envía al servidor y al proveedor de IA para poder responderte.",
        buttons: ["Permitir búsqueda en mi equipo", "Elegir una carpeta…", "No permitir"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      };
      const parent = window();
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (response === 0) return { kind: "home" };
      if (response === 1) {
        const path = await pickFolder(reason);
        return path ? { kind: "folder", path } : null;
      }
      return null;
    },
  };
}
