import type { ServerConnectionPort } from "../../core/connection";

export class ElectronConnectionAdapter implements ServerConnectionPort {
  load() {
    return window.desktop.connection.load();
  }

  connect(baseUrl: string) {
    return window.desktop.connection.connect(baseUrl);
  }

  check(baseUrl: string) {
    return window.desktop.connection.check(baseUrl);
  }
}
