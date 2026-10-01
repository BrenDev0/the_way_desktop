import { useEffect, useMemo, useState, type FormEvent } from "react";
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
 * Two screens: signed out, the sign-in (with the server address when the build does not
 * fix one); signed in, the chat. Until the server has answered and a saved session has
 * been tried, a splash -- so a signed-in operator never sees the sign-in flash past.
 */
export function App() {
  const service = useMemo(() => new ConnectionService(new ElectronConnectionAdapter()), []);
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState<ViewStatus>("loading");
  const [message, setMessage] = useState("Buscando el servidor…");
  const [locked, setLocked] = useState(false);
  const [user, setUser] = useState<DesktopUser | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const settings = await service.load();
        if (!active) return;
        setLocked(settings.locked);
        if (!settings.baseUrl) {
          setStatus("idle");
          setMessage("Introduce la dirección de tu servidor para comenzar.");
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

  async function connect(event: FormEvent) {
    event.preventDefault();
    setStatus("checking");
    setMessage("Comprobando conexión…");
    try {
      applyResult(await service.connect(baseUrl));
    } catch {
      setStatus("unreachable");
      setMessage("No se pudo guardar la conexión. Inténtalo de nuevo.");
    }
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

        <section className="connection-card login__server" aria-label="Servidor">
          <div className="card-heading">
            <span>SERVIDOR</span>
            <span className={`login__state login__state--${status}`}>
              <span className={connected ? "dot dot--on" : "dot"} /> {connected ? "CONECTADO" : status === "checking" ? "COMPROBANDO" : "SIN CONEXIÓN"}
            </span>
          </div>
          {locked ? (
            <div className="login__address">
              <output className="selectable">{baseUrl}</output>
              {!connected && (
                <button type="button" className="ghost-button" disabled={status === "checking"}
                  onClick={() => { setStatus("checking"); void service.check(baseUrl).then(applyResult); }}>
                  REINTENTAR
                </button>
              )}
            </div>
          ) : (
            <form className="login__address" onSubmit={connect}>
              <div className="url-field">
                <span aria-hidden="true">❯</span>
                <input
                  aria-label="Dirección del servidor"
                  type="url"
                  placeholder="https://api.tu-organizacion.com"
                  autoComplete="url"
                  spellCheck={false}
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    setStatus("idle");
                    setMessage("Comprueba la nueva dirección para guardarla.");
                  }}
                  required
                  disabled={status === "checking"}
                />
              </div>
              <button className="ghost-button" type="submit" disabled={status === "checking" || !baseUrl.trim()}>
                {status === "checking" ? "…" : connected ? "CAMBIAR" : "CONECTAR"}
              </button>
            </form>
          )}
          {!connected && <p className="login__message" role="status">{message}</p>}
        </section>

        {connected ? <SignIn onSignedIn={setUser} /> : (
          <p className="login__hint">{locked ? "Cuando el servidor responda podrás iniciar sesión." : "Conecta un servidor para iniciar sesión. En desarrollo: http://localhost:8000"}</p>
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
