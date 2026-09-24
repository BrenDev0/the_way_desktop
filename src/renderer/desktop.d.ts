import type { ServerConnectionPort } from "../core/connection";

declare global {
  interface Window {
    desktop: {
      connection: ServerConnectionPort;
    };
  }
}
