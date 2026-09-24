import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionResult, ServerConnectionPort } from "../core/connection";

const connection: ServerConnectionPort = {
  load: () => ipcRenderer.invoke("connection:load") as Promise<string | null>,
  connect: (baseUrl: string) => ipcRenderer.invoke("connection:connect", baseUrl) as Promise<ConnectionResult>,
  check: (baseUrl: string) => ipcRenderer.invoke("connection:check", baseUrl) as Promise<ConnectionResult>,
};

contextBridge.exposeInMainWorld("desktop", { connection });
