import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Conversation } from "../../../core/api";

const STATUS: Record<Conversation["status"], string> = {
  idle: "LISTA",
  running: "TRABAJANDO…",
  awaiting_client: "ESPERA A ESTE EQUIPO",
  failed: "FALLÓ",
};

function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "ahora";
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.round(seconds / 3600)} h`;
  return `hace ${Math.round(seconds / 86400)} d`;
}

/** Folded the way people type: no case, no accents. */
function folded(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onOpen(conversation: Conversation): void;
  onNew(): void;
  onDelete(conversation: Conversation): Promise<void>;
}

/**
 * Which conversation this is, right by the box you type in: its title opens the list
 * (searchable, newest first) to switch to another, and + starts a new one. The list opens
 * upwards, since it sits at the bottom of the chat.
 */
export function ConversationPicker({ conversations, activeId, onOpen, onNew, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;

  const shown = useMemo(() => {
    const wanted = folded(query.trim());
    return [...conversations]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((conversation) => !wanted || folded(conversation.title).includes(wanted));
  }, [conversations, query]);

  // closes on a click anywhere else
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setConfirming(null);
    setCursor(Math.max(0, shown.findIndex((conversation) => conversation.id === activeId)));
    requestAnimationFrame(() => search.current?.focus());
    // only on opening: the list moving underneath should not move the cursor
  }, [open]);

  function pick(conversation: Conversation) {
    setOpen(false);
    if (conversation.id !== activeId) onOpen(conversation);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setCursor((current) => Math.min(Math.max(current + step, 0), Math.max(shown.length - 1, 0)));
    } else if (event.key === "Enter" && shown[cursor]) {
      event.preventDefault();
      pick(shown[cursor]);
    }
  }

  async function remove(conversation: Conversation) {
    setConfirming(null);
    await onDelete(conversation);
  }

  return (
    <div className="convo" ref={root} onKeyDown={onKey}>
      <button
        type="button"
        className={open ? "convo__current convo__current--open" : "convo__current"}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={active ? `${active.title} — cambiar de conversación` : "Elegir una conversación"}
      >
        <span className="convo__caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
        <span className="convo__title">{active?.title ?? "Nueva conversación"}</span>
        {active && <span className={`convo__status convo__status--${active.status}`}>{STATUS[active.status]}</span>}
      </button>
      <button type="button" className="convo__new" onClick={() => { setOpen(false); onNew(); }} title="Nueva conversación" aria-label="Nueva conversación">
        +
      </button>

      {open && (
        <div className="convo__menu" role="dialog" aria-label="Conversaciones">
          <div className="convo__search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={search}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
              placeholder={`Buscar entre ${conversations.length} conversaciones…`}
              spellCheck={false}
            />
          </div>
          <ul className="convo__list" role="listbox" aria-label="Conversaciones">
            {shown.map((conversation, index) => (
              <li key={conversation.id} role="option" aria-selected={conversation.id === activeId}>
                {confirming === conversation.id ? (
                  <div className="convo__confirm">
                    <span>¿Eliminar "{conversation.title}"? No se puede deshacer.</span>
                    <button type="button" className="ghost-button ghost-button--danger" onClick={() => void remove(conversation)}>ELIMINAR</button>
                    <button type="button" className="ghost-button" onClick={() => setConfirming(null)}>NO</button>
                  </div>
                ) : (
                  <div
                    className={[
                      "convo__item",
                      conversation.id === activeId && "convo__item--active",
                      index === cursor && "convo__item--cursor",
                    ].filter(Boolean).join(" ")}
                    onMouseEnter={() => setCursor(index)}
                  >
                    <button type="button" className="convo__pick" onClick={() => pick(conversation)} title={conversation.title}>
                      <span className="convo__item-title">{conversation.title}</span>
                      <span className="convo__item-meta">
                        <span className={`convo__status convo__status--${conversation.status}`}>{STATUS[conversation.status]}</span>
                        <span>{ago(conversation.updatedAt)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="convo__delete"
                      onClick={() => setConfirming(conversation.id)}
                      disabled={conversation.status === "running"}
                      title={conversation.status === "running" ? "Está trabajando; espera a que termine" : "Eliminar conversación"}
                      aria-label={`Eliminar ${conversation.title}`}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </li>
            ))}
            {!shown.length && (
              <li className="convo__none">{conversations.length ? "Ninguna coincide." : "Sin conversaciones todavía."}</li>
            )}
          </ul>
          <button type="button" className="convo__menu-new" onClick={() => { setOpen(false); onNew(); }}>
            + NUEVA CONVERSACIÓN
          </button>
        </div>
      )}
    </div>
  );
}
