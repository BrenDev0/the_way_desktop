import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewedFile } from "../../../core/bridge";
import { viewKind } from "../../../core/files/produced";
import { Markdown } from "../chat/Markdown";
import type { ViewRequest } from "./FileChips";
import { errorText, formatSize } from "./helpers";
import "./viewer.css";

// Past this a text file is shown in part; the whole of it is a download away.
const MAX_TEXT_CHARS = 2_000_000;

/**
 * Looks at a file without leaving the app: pictures, PDFs (Chromium's own viewer), HTML
 * pages, markdown (rendered as the chat renders replies, its source a click away) and
 * text. Anything else can be saved or handed to the program the system uses for it.
 *
 * An HTML page is shown in a sandboxed frame with no scripts and no access to the app --
 * the agent's pages have none, and a page brought in from the web must not get any.
 */
export function FileViewer({ request, onClose }: { request: ViewRequest; onClose(): void }) {
  const [file, setFile] = useState<ViewedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actual, setActual] = useState(false);
  // a markdown file opens rendered; its source is one click away
  const [source, setSource] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setError(null);
    setNotice(null);
    setActual(false);
    setSource(false);
    const load = request.source === "project"
      ? window.desktop.viewer.project(request.project, request.path)
      : window.desktop.viewer.local(request.path);
    load.then(
      (loaded) => { if (!cancelled) setFile(loaded); },
      (reason) => { if (!cancelled) setError(errorText(reason)); },
    );
    return () => { cancelled = true; };
  }, [request]);

  useEffect(() => {
    close.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const kind = file ? viewKind(file.contentType, file.name) : null;
  const url = useMemo(() => {
    if (!file || (kind !== "image" && kind !== "pdf")) return null;
    return URL.createObjectURL(new Blob([file.data.slice()], { type: kind === "pdf" ? "application/pdf" : file.contentType }));
  }, [file, kind]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const text = useMemo(() => {
    if (!file || (kind !== "text" && kind !== "html" && kind !== "markdown")) return "";
    return new TextDecoder().decode(file.data);
  }, [file, kind]);
  const shown = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[… recortado: descárgalo para verlo entero]` : text;

  async function save() {
    if (!file) return;
    try {
      const where = await window.desktop.viewer.save(file.name, file.data);
      if (where) setNotice(`Guardado en ${where}`);
    } catch (reason) {
      setNotice(errorText(reason));
    }
  }

  async function openExternal() {
    if (!file) return;
    try {
      await window.desktop.viewer.openExternal(file.name, file.data);
    } catch (reason) {
      setNotice(errorText(reason));
    }
  }

  const name = file?.name ?? (request.path.split("/").pop() || request.path);
  const where = request.source === "project" ? `${request.project}/${request.path}` : request.path;

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Vista de ${name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="viewer__panel">
        <header className="viewer__bar">
          <div className="viewer__title">
            <strong className="selectable">{name}</strong>
            <span className="selectable">{where}{file ? ` · ${formatSize(file.data.byteLength)}` : ""}</span>
          </div>
          {kind === "image" && (
            <button type="button" className="ghost-button" onClick={() => setActual((value) => !value)} aria-pressed={actual}>
              {actual ? "AJUSTAR" : "TAMAÑO REAL"}
            </button>
          )}
          {kind === "markdown" && (
            <button type="button" className="ghost-button" onClick={() => setSource((value) => !value)} aria-pressed={source}>
              {source ? "¶ VISTA" : "</> CÓDIGO"}
            </button>
          )}
          <button type="button" className="ghost-button" onClick={() => void openExternal()} disabled={!file}>ABRIR CON LA APP ↗</button>
          <button type="button" className="connect-button viewer__download" onClick={() => void save()} disabled={!file}>
            DESCARGAR <span aria-hidden="true">↓</span>
          </button>
          <button type="button" ref={close} className="viewer__close" onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)">×</button>
        </header>
        {notice && <p className="viewer__notice selectable" role="status">{notice}</p>}

        <div className={`viewer__body viewer__body--${kind ?? "loading"}`}>
          {error && <p className="viewer__message" role="alert">{error}</p>}
          {!error && !file && <p className="viewer__message">Cargando…</p>}
          {kind === "image" && url && (
            <img src={url} alt={name} className={actual ? "viewer__image viewer__image--actual" : "viewer__image"} onClick={() => setActual((value) => !value)} />
          )}
          {kind === "pdf" && url && <iframe title={name} src={url} className="viewer__frame" />}
          {kind === "html" && <iframe title={name} srcDoc={text} sandbox="" className="viewer__frame viewer__frame--page" />}
          {(kind === "text" || (kind === "markdown" && source)) && <pre className="viewer__text selectable">{shown}</pre>}
          {kind === "markdown" && !source && (
            <article className="viewer__document">
              <Markdown text={shown} />
            </article>
          )}
          {kind === "other" && file && (
            <div className="viewer__message">
              <p>Este tipo de archivo no se puede previsualizar aquí.</p>
              <p className="viewer__hint">Ábrelo con la aplicación del sistema o descárgalo.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
