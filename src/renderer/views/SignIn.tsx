import { useState, type FormEvent } from "react";
import type { DesktopUser } from "../../core/api";
import { errorText } from "./files/helpers";

interface Props {
  onSignedIn(user: DesktopUser): void;
}

/** Signs the app in. The token goes from the server straight into the main process's
 *  encrypted store; this view only ever sees the user it belongs to. */
export function SignIn({ onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await window.desktop.auth.login(email, password);
      if (user) onSignedIn(user);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <section className="connection-card signin-card" aria-labelledby="signin-title">
      <div className="card-heading"><span>ACCESO</span><span className="card-heading__accent">● SESIÓN CIFRADA</span></div>
      <h2 id="signin-title">Inicia sesión</h2>
      <p className="connection-card__copy">Usa la cuenta de tu organización. La sesión se guarda cifrada en este equipo.</p>
      <form onSubmit={submit}>
        <label htmlFor="signin-email">CORREO</label>
        <div className="url-field">
          <span aria-hidden="true">@</span>
          <input id="signin-email" type="email" autoComplete="username" spellCheck={false} required
            value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
        </div>
        <label htmlFor="signin-password" className="signin-card__label">CONTRASEÑA</label>
        <div className="url-field">
          <span aria-hidden="true">⚿</span>
          <input id="signin-password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        </div>
        <button className="connect-button signin-card__submit" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? "ENTRANDO..." : "ENTRAR"} <span aria-hidden="true">↗</span>
        </button>
      </form>
      {error && (
        <div className="connection-result connection-result--unreachable" role="alert">
          <span className="connection-result__symbol" aria-hidden="true">!</span>
          <div><strong>NO SE PUDO ENTRAR</strong><p>{error}</p></div>
        </div>
      )}
    </section>
  );
}

/** Already said for the person by the time it gets here (core/userMessages). */
function messageFor(reason: unknown): string {
  return errorText(reason);
}
