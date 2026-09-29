import { ApiError, type HttpMethod, type ServerApiPort } from "../core/api";
import type { TokenStorePort } from "../core/auth";
import type { ServerConnectionPort } from "../core/connection";

const DESKTOP_API = "/api/desktop/v1";
const TIMEOUT = 30_000;

/**
 * Every call to the server goes through here, in the main process. It adds the saved
 * server address and the bearer token; a 401 means the token is gone for good (signed
 * out, revoked, expired), so it is dropped and the window told to show the sign-in.
 */
export class ApiClient implements ServerApiPort {
  constructor(
    private readonly connection: ServerConnectionPort,
    private readonly tokens: TokenStorePort,
    private readonly onSignedOut: () => void,
  ) {}

  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const { baseUrl } = await this.connection.load();
    if (!baseUrl) throw new ApiError(0, "not_connected", "No server is connected yet.");

    const token = await this.tokens.load();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${DESKTOP_API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT),
        cache: "no-store",
      });
    } catch {
      throw new ApiError(0, "unreachable", "The server could not be reached.");
    }

    const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);

    if (!response.ok) {
      const { code, message } = errorOf(payload);
      // A wrong password on the login itself is not a lost session.
      if (response.status === 401 && path !== LOGIN) await this.signedOut();
      throw new ApiError(response.status, code ?? "error", message ?? `The server answered ${response.status}.`);
    }
    return payload as T;
  }

  /**
   * Opens a server-sent events stream: same address, token and sign-out handling as
   * request(), but the response body is handed back to be read as it arrives.
   */
  async stream(path: string, lastEventId: string | undefined, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const { baseUrl } = await this.connection.load();
    if (!baseUrl) throw new ApiError(0, "not_connected", "No server is connected yet.");

    const token = await this.tokens.load();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${DESKTOP_API}${path}`, { headers, signal, cache: "no-store" });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiError(0, "unreachable", "The server could not be reached.");
    }

    if (!response.ok || !response.body) {
      const { code, message } = errorOf(await response.json().catch(() => null));
      if (response.status === 401) await this.signedOut();
      throw new ApiError(response.status, code ?? "error", message ?? `The server answered ${response.status}.`);
    }
    return response.body;
  }

  /** Any 401 means this app is not signed in -- with a token the server refused, or with
   *  none at all -- so the window must say so rather than keep retrying. */
  private async signedOut(): Promise<void> {
    await this.tokens.clear();
    this.onSignedOut();
  }
}

const LOGIN = "/auth/login";

function errorOf(payload: unknown): { code?: string; message?: string } {
  if (typeof payload !== "object" || payload === null) return {};
  const record = payload as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
  };
}
