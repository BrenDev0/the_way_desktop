import type { ServerConnectionPort } from "./connection";

export class ConnectionService {
  constructor(private readonly server: ServerConnectionPort) {}

  load() {
    return this.server.load();
  }

  connect(baseUrl: string) {
    return this.server.connect(baseUrl.trim());
  }

  check(baseUrl: string) {
    return this.server.check(baseUrl.trim());
  }
}
