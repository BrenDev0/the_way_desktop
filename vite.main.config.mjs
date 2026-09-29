import { defineConfig, loadEnv } from "vite";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

// The backend URL is compiled into the main process. It is not a secret; it only
// fixes which server this build trusts. Production builds must set it and use HTTPS.
function serverUrl(mode) {
  const raw = loadEnv(mode, process.cwd(), "THE_WAY_").THE_WAY_SERVER_URL?.trim() ?? "";
  if (!raw) {
    if (mode === "production") {
      throw new Error("Set THE_WAY_SERVER_URL (e.g. https://api.example.com) before packaging THE WAY Desktop.");
    }
    return "";
  }

  const url = new URL(raw);
  const allowed = url.protocol === "https:" || (mode !== "production" && url.protocol === "http:" && LOOPBACK.includes(url.hostname));
  if (!allowed || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`THE_WAY_SERVER_URL must be a bare HTTPS origin${mode === "production" ? "" : " (or loopback HTTP in development)"}: ${raw}`);
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
      external: ["electron", "node:crypto", "node:fs/promises", "node:os", "node:path"],
    },
  },
}));
