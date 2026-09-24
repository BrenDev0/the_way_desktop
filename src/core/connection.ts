export interface ConnectionResult {
  baseUrl: string;
  status: "connected" | "unreachable";
  message: string;
}

export interface ServerConnectionPort {
  load(): Promise<string | null>;
  connect(baseUrl: string): Promise<ConnectionResult>;
  check(baseUrl: string): Promise<ConnectionResult>;
}
