export interface ConnectionResult {
  baseUrl: string;
  status: "connected" | "unreachable";
  message: string;
}

export interface ServerSettings {
  baseUrl: string | null;
  /** True when the build fixes the server; the app then ignores any other address. */
  locked: boolean;
}

export interface ServerConnectionPort {
  load(): Promise<ServerSettings>;
  connect(baseUrl: string): Promise<ConnectionResult>;
  check(baseUrl: string): Promise<ConnectionResult>;
}
