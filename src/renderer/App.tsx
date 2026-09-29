import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { DesktopUser } from "../core/api";
import type { ConnectionResult } from "../core/connection";
import { ConnectionService } from "../core/connectionService";
import { ElectronConnectionAdapter } from "./infrastructure/ElectronConnectionAdapter";
import { Logo } from "./Logo";
import { conversationStore } from "./state/conversations";
import { ConversationList } from "./views/ConversationList";
import { SignIn } from "./views/SignIn";
import { Workbench } from "./views/Workbench";

type ViewStatus = "loading" | "idle" | "checking" | "connected" | "unreachable";
type Section = "home" | "conversations";

export function App() {
  const service = useMemo(() => new ConnectionService(new ElectronConnectionAdapter()), []);
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState<ViewStatus>("loading");
  const [message, setMessage] = useState("Buscando un servidor guardado...");
  const [locked, setLocked] = useState(false);
  const [user, setUser] = useState<DesktopUser | null>(null);
  const [section, setSection] = useState<Section>("home");

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
          return;
        }
        setBaseUrl(settings.baseUrl);
        setStatus("checking");
        setMessage("Comprobando conexión...");
        const result = await service.check(settings.baseUrl);
        if (active) applyResult(result);
      } catch {
        if (active) {
          setStatus("unreachable");
          setMessage("No se pudo leer la configuración guardada.");
        }
      }
    }
    void restore();
    return () => { active = false; };
  }, [service]);

  // Once the server answers, a saved session opens straight into the conversations.
  useEffect(() => {
    if (status !== "connected") return;
    let active = true;
    void window.desktop.auth.state().then(({ user: restored }) => {
      if (!active) return;
      setUser(restored);
      if (restored) setSection("conversations");
    }).catch(() => {});
    return () => { active = false; };
  }, [status]);

  // A token the server stopped accepting (revoked, expired) lands back on the sign-in.
  useEffect(() => window.desktop.auth.onSignedOut(() => {
    conversationStore.clear();
    setUser(null);
    setSection("home");
  }), []);

  function signedIn(signed: DesktopUser) {
    setUser(signed);
    setSection("conversations");
  }

  async function signOut() {
    await window.desktop.auth.logout().catch(() => {});
    conversationStore.clear();
    setUser(null);
    setSection("home");
  }

  function applyResult(result: ConnectionResult) {
    setBaseUrl(result.baseUrl);
    setStatus(result.status);
    setMessage(result.message);
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    setStatus("checking");
    setMessage("Comprobando conexión...");
    try {
      applyResult(await service.connect(baseUrl));
    } catch {
      setStatus("unreachable");
      setMessage("No se pudo guardar la conexión. Inténtalo de nuevo.");
    }
  }

  const connected = status === "connected";

  return (
    <div className="desktop">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Logo />
          <span>DESKTOP / OPERADOR</span>
        </div>
        <nav className="sidebar__nav" aria-label="Navegación">
          <button type="button" className={`sidebar__nav-item sidebar__nav-button${section === "home" ? " sidebar__nav-item--active" : ""}`} onClick={() => setSection("home")}><span>⌁</span> Inicio</button>
          <span className="sidebar__nav-item sidebar__nav-item--disabled"><span>▧</span> Herramientas <small>PRONTO</small></span>
          {!user && <span className="sidebar__nav-item sidebar__nav-item--disabled"><span>◇</span> Conversaciones <small>INICIA SESIÓN</small></span>}
        </nav>
        {user && <ConversationList onShow={() => setSection("conversations")} />}
        <div className="sidebar__bottom">
          {user && (
            <div className="sidebar__account">
              <span className="selectable" title={user.email}>{user.email}</span>
              <button type="button" className="ghost-button" onClick={() => void signOut()}>SALIR</button>
            </div>
          )}
          <div className="sidebar__status">
            <span className={connected ? "dot dot--on" : "dot"} />
            <span>{connected ? "SERVIDOR CONECTADO" : "SERVIDOR SIN CONEXIÓN"}</span>
          </div>
          <span className="sidebar__version">THE WAY · DESKTOP ALPHA 0.1</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="topbar__prompt">❯</span> PUESTO DE TRABAJO <span className="topbar__slash">/</span> {section === "conversations" && user ? "CONVERSACIONES" : "CONEXIÓN"}</div>
          <div className="topbar__right"><span className="topbar__pulse" /> SISTEMA LOCAL</div>
        </header>

        {/* Kept mounted while signed in, so a turn in progress and the open chat survive a visit to Inicio. */}
        {user && (
          <div className="workspace__stage" hidden={section !== "conversations"}>
            <Workbench user={user} />
          </div>
        )}
        {section === "conversations" && user ? null : (
        <div className="workspace__content">
          <div className="hero">
            <p className="eyebrow"><span className="eyebrow__line" /> EL CAMINO COMIENZA AQUÍ</p>
            <h1>Tu espacio para <span>hacer que las cosas pasen.</span></h1>
            <p>Conecta THE WAY con tu organización. El agente trabajará desde el servidor y las herramientas locales permanecerán en tu equipo.</p>
          </div>

          <div className="grid">
            <section className="connection-card" aria-labelledby="connection-title">
              <div className="card-heading"><span>01 / CONEXIÓN</span><span className="card-heading__accent">● ENLACE SEGURO</span></div>
              <h2 id="connection-title">{locked ? "Servidor de THE WAY" : "Conecta tu servidor"}</h2>
              <p className="connection-card__copy">
                {locked
                  ? "Esta versión se conecta automáticamente al servidor oficial de THE WAY."
                  : "Usa la dirección que te proporcione tu organización. Puedes cambiarla más adelante."}
              </p>
              <form onSubmit={connect}>
                <label htmlFor="server-url">DIRECCIÓN DEL SERVIDOR</label>
                {locked ? (
                  <div className="url-field url-field--locked">
                    <span aria-hidden="true">⚿</span>
                    <output id="server-url">{baseUrl}</output>
                  </div>
                ) : (
                <div className="url-field">
                  <span aria-hidden="true">❯</span>
                  <input
                    id="server-url"
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
                    disabled={status === "loading" || status === "checking"}
                  />
                </div>
                )}
                <p className="field-help">{locked ? "Dirección fijada en esta versión de la aplicación." : "Para desarrollo local: http://localhost:8000"}</p>
                <button className="connect-button" type="submit" disabled={status === "loading" || status === "checking" || !baseUrl.trim()}>
                  {status === "checking" ? "COMPROBANDO..." : connected || locked ? "VOLVER A COMPROBAR" : "CONECTAR SERVIDOR"}
                  <span aria-hidden="true">↗</span>
                </button>
              </form>
              <div className={`connection-result connection-result--${status}`} role="status" aria-live="polite">
                <span className="connection-result__symbol" aria-hidden="true">{connected ? "✓" : status === "unreachable" ? "!" : "○"}</span>
                <div>
                  <strong>{connected ? "CONEXIÓN ESTABLECIDA" : status === "unreachable" ? "SIN CONEXIÓN" : status === "checking" ? "COMPROBANDO ENLACE" : "ESPERANDO SERVIDOR"}</strong>
                  <p>{message}</p>
                </div>
              </div>
            </section>

            {connected && !user ? <SignIn onSignedIn={signedIn} /> : (
            <section className="flow-card" aria-labelledby="flow-title">
              <div className="card-heading"><span>02 / TU FLUJO</span><span>THE WAY</span></div>
              <h2 id="flow-title">Un agente. Dos mundos.</h2>
              <p>El contexto de tu organización y las acciones en tu equipo se encuentran aquí.</p>
              <div className="flow-list">
                <div className="flow-list__item">
                  <span className="flow-list__icon">◎</span>
                  <div><strong>AGENTE EN EL SERVIDOR</strong><p>Conversaciones y decisiones coordinadas de forma central.</p></div>
                  <span className="flow-list__index">01</span>
                </div>
                <div className="flow-list__item">
                  <span className="flow-list__icon flow-list__icon--pink">⌘</span>
                  <div><strong>CONTEXTO COMPARTIDO</strong><p>La identidad y el conocimiento de tu organización.</p></div>
                  <span className="flow-list__index">02</span>
                </div>
                <div className="flow-list__item">
                  <span className="flow-list__icon">▣</span>
                  <div><strong>HERRAMIENTAS LOCALES</strong><p>Acciones en este equipo, bajo tu control.</p></div>
                  <span className="flow-list__index">03</span>
                </div>
              </div>
            </section>
            )}
          </div>
          <p className="next-step">{!connected ? "CONEXIÓN REQUERIDA PARA CONTINUAR" : user ? `SESIÓN INICIADA · ${user.email}` : "SERVIDOR LISTO · EL SIGUIENTE PASO ES INICIAR SESIÓN"}</p>
        </div>
        )}
      </main>
    </div>
  );
}
