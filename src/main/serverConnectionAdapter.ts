import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConnectionResult, ServerConnectionPort, ServerSettings } from "../core/connection";

interface SavedConnection {
  baseUrl: string;
}

export class ServerConnectionAdapter implements ServerConnectionPort {
  private readonly configPath: string;

  /** With a built-in server, every call targets it and addresses from the renderer are ignored. */
  constructor(userDataDirectory: string, private readonly builtInUrl: string | null = null) {
    this.configPath = join(userDataDirectory, "connection.json");
  }

  async load(): Promise<ServerSettings> {
    if (this.builtInUrl) return { baseUrl: this.builtInUrl, locked: true };
    try {
      const saved = JSON.parse(await readFile(this.configPath, "utf8")) as SavedConnection;
      return { baseUrl: typeof saved.baseUrl === "string" ? saved.baseUrl : null, locked: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { baseUrl: null, locked: false };
      throw error;
    }
  }

  async connect(baseUrl: string): Promise<ConnectionResult> {
    const result = await this.check(baseUrl);
    if (result.status === "connected" && !this.builtInUrl) {
      await writeFile(this.configPath, JSON.stringify({ baseUrl: result.baseUrl }), "utf8");
    }
    return result;
  }

  async check(requestedUrl: string): Promise<ConnectionResult> {
    const baseUrl = this.builtInUrl ?? requestedUrl;
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      return { baseUrl, status: "unreachable", message: "Ingresa una URL válida del servidor." };
    }

    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/"
    ) {
      return {
        baseUrl,
        status: "unreachable",
        message: "Usa HTTPS, o HTTP solo para un servidor local, sin ruta ni credenciales.",
      };
    }

    const normalized = url.origin;
    try {
      const response = await fetch(`${normalized}/health`, {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (response.ok && typeof body === "object" && body !== null && "status" in body && body.status === "ok") {
        return { baseUrl: normalized, status: "connected", message: "Servidor disponible." };
      }
      return { baseUrl: normalized, status: "unreachable", message: "El servidor no respondió como THE WAY." };
    } catch {
      return { baseUrl: normalized, status: "unreachable", message: "No se pudo conectar con el servidor." };
    }
  }
}
