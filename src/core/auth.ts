import { ApiError, type DesktopUser, type ServerApiPort } from "./api";

export interface AuthState {
  user: DesktopUser | null;
}

/** Where the session token lives. The main process keeps it encrypted; nothing else sees it. */
export interface TokenStorePort {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
  clear(): Promise<void>;
}

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: DesktopUser;
}

/** Signing in and out. The token goes straight from the login response into the store and
 *  is never returned to the caller, so it cannot leak into the interface. */
export class AuthService {
  constructor(
    private readonly api: ServerApiPort,
    private readonly tokens: TokenStorePort,
  ) {}

  async login(email: string, password: string, deviceName: string): Promise<AuthState> {
    const response = await this.api.request<LoginResponse>("POST", "/auth/login", {
      email: email.trim(),
      password,
      deviceName,
    });
    await this.tokens.save(response.token);
    return { user: response.user };
  }

  /** The signed-in user, or none. A token the server no longer accepts is dropped. */
  async restore(): Promise<AuthState> {
    if (!(await this.tokens.load())) return { user: null };
    try {
      return { user: await this.api.request<DesktopUser>("GET", "/users/me") };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await this.tokens.clear();
        return { user: null };
      }
      throw error;
    }
  }

  async logout(): Promise<AuthState> {
    try {
      await this.api.request("POST", "/auth/logout");
    } catch (error) {
      // An already-dead token is exactly the state logging out wants to reach.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    } finally {
      await this.tokens.clear();
    }
    return { user: null };
  }
}
