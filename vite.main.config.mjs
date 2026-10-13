import { defineConfig, loadEnv } from "vite";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

// The deployed backend: every build connects to it, and the app offers no way to pick
// another. THE_WAY_SERVER_URL overrides it -- a backend on this machine, for development.
const DEPLOYED_SERVER_URL = "https://the-way-server.up.railway.app";

// The backend URL is compiled into the main process. It is not a secret; it only
// fixes which server this build trusts, and it must be HTTPS.
// THE_WAY_LOCAL_BUILD=1 makes an installable build for this computer only, against a
// backend on it (http://localhost:8000): plain HTTP to loopback never leaves the machine.
function serverUrl(mode) {
  const env = loadEnv(mode, process.cwd(), "THE_WAY_");
  const raw = env.THE_WAY_SERVER_URL?.trim() || DEPLOYED_SERVER_URL;
  const local = mode !== "production" || env.THE_WAY_LOCAL_BUILD === "1";

  const url = new URL(raw);
  const allowed = url.protocol === "https:" || (local && url.protocol === "http:" && LOOPBACK.includes(url.hostname));
  if (!allowed || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`THE_WAY_SERVER_URL must be a bare HTTPS origin${local ? " (or loopback HTTP)" : " (or loopback HTTP with THE_WAY_LOCAL_BUILD=1)"}: ${raw}`);
  }
  return url.origin;
}

export default defineConfig(({ mode }) => ({
  define: {
    THE_WAY_SERVER_URL: JSON.stringify(serverUrl(mode)),
  },
  build: {
    rollupOptions: {
      // Node built-ins the main process imports; each new one must be added here.
      external: ["electron", "node:child_process", "node:crypto", "node:fs/promises", "node:os", "node:path"],
    },
  },
}));
