import { useEffect, useMemo, useState } from "react";
import type { DesktopUser } from "../core/api";
import type { ConnectionResult } from "../core/connection";
import { ConnectionService } from "../core/connectionService";
import { ElectronConnectionAdapter } from "./infrastructure/ElectronConnectionAdapter";
import { Logo } from "./Logo";
import { conversationStore } from "./state/conversations";
import { SignIn } from "./views/SignIn";
import { Workbench } from "./views/Workbench";

type ViewStatus = "loading" | "idle" | "checking" | "connected" | "unreachable";

/**
 * Two screens: signed out, the sign-in; signed in, the chat. The server is built in
 * (vite.main.config.mjs) -- there is no address to type or pick. Until the server has answered and a saved session has
 * been tried, a splash -- so a signed-in operator never sees the sign-in flash past.
 */
export function App() {
  const service = useMemo(() => new ConnectionService(new ElectronConnectionAdapter()), []);
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState<ViewStatus>("loading");
  const [message, setMessage] = useState("Buscando el servidor…");
  const [user, setUser] = useState<DesktopUser | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const settings = await service.load();
        if (!active) return;
        if (!settings.baseUrl) {
          setStatus("idle");
          setMessage("Esta versión no tiene un servidor configurado.");
          setBooting(false);
          return;
        }
        setBaseUrl(settings.baseUrl);
        setStatus("checking");
        setMessage("Comprobando conexión…");
        const result = await service.check(settings.baseUrl);
        if (!active) return;
        applyResult(result);
        if (result.status !== "connected") setBooting(false);
      } catch {
        if (!active) return;
        setStatus("unreachable");
        setMessage("No se pudo leer la configuración guardada.");
        setBooting(false);
      }
    }
    void restore();
    return () => { active = false; };
  }, [service]);

  // Once the server answers, a saved session opens straight into the chat.
  useEffect(() => {
    if (status !== "connected") return;
    let active = true;
    void window.desktop.auth.state()
      .then(({ user: restored }) => { if (active) setUser(restored); })
      .catch(() => {})
      .finally(() => { if (active) setBooting(false); });
    return () => { active = false; };
  }, [status]);

  // A token the server stopped accepting (revoked, expired) lands back on the sign-in.
  useEffect(() => window.desktop.auth.onSignedOut(() => {
    conversationStore.clear();
    setUser(null);
  }), []);

  async function signOut() {
    await window.desktop.auth.logout().catch(() => {});
    conversationStore.clear();
    setUser(null);
  }

  function applyResult(result: ConnectionResult) {
    setBaseUrl(result.baseUrl);
    setStatus(result.status);
    setMessage(result.message);
  }

  const connected = status === "connected";

  if (booting) {
    return (
      <div className="boot" role="status" aria-live="polite">
        <Logo />
        <span className="boot__line"><span className="topbar__pulse" /> {message.toUpperCase()}</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login">
        <div className="login__brand">
          <Logo />
          <span>DESKTOP / OPERADOR</span>
        </div>

        {/* The server is built in; while it does not answer, the sign-in waits on a retry. */}
        {connected ? <SignIn onSignedIn={setUser} /> : (
          <section className="connection-card login__server" aria-label="Conexión">
            <p className="login__message" role="status">{message}</p>
            {baseUrl && (
              <div className="login__address">
                <button type="button" className="ghost-button" disabled={status === "checking"}
                  onClick={() => { setStatus("checking"); setMessage("Comprobando conexión…"); void service.check(baseUrl).then(applyResult); }}>
                  {status === "checking" ? "…" : "REINTENTAR"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    );
  }

  return (
    // One column of work: the logo, the account and the server's state ride on the files
    // column (Workbench), and conversations are picked by the message box.
    <div className="desktop">
      <main className="workspace">
        <Workbench user={user} connected={connected} onSignOut={() => void signOut()} />
      </main>
    </div>
  );
}
