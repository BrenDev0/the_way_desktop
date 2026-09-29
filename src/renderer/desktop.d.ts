import type { DesktopBridge } from "../core/bridge";

declare global {
  interface Window {
    desktop: DesktopBridge;
  }
}
