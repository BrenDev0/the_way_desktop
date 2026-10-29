import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatFolder, Conversation } from "../../../core/api";
import { errorText } from "../files/helpers";
import { sectionsOf, visibleChats } from "./folders";

const STATUS: Record<Conversation["status"], string> = {
  idle: "LISTA",
  running: "AGENTIX TRABAJANDO…",
  awaiting_client: "ESPERA A ESTE EQUIPO",
  paused: "EN PAUSA",
  failed: "FALLÓ",
};

const MAX_FOLDER_NAME = 60;

function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "Ahora";
  if (seconds < 3600) return `Hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.round(seconds / 3600)} h`;
  return `Hace ${Math.round(seconds / 86400)} d`;
}

/** Folded the way people type: no case, no accents. */
function folded(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

interface Props {
  conversations: Conversation[];
  folders: ChatFolder[];
  activeId: string | null;
  onOpen(conversation: Conversation): void;
  onNew(): void;
  onDelete(conversation: Conversation): Promise<void>;
  /** Files a chat in a folder, or (null) takes it out of its folder. */
  onMove(conversation: Conversation, folderId: string | null): Promise<void>;
  onCreateFolder(name: string): Promise<ChatFolder>;
  onRenameFolder(folder: ChatFolder, name: string): Promise<void>;
  /** The folder's chats are not deleted: they go back to the main list. */
  onRemoveFolder(folder: ChatFolder): Promise<void>;
}

/**
 * Which conversation this is, right by the box you type in: its title opens the list
 * (searchable, newest first) to switch to another, and + starts a new one. The list opens
 * upwards, since it sits at the bottom of the chat. The person's own folders keep chats apart:
 * one level, each folds away, and a chat is moved into one from its own row.
 */
export function ConversationPicker({
  conversations,
  folders,
  activeId,
  onOpen,
  onNew,
  onDelete,
  onMove,
  onCreateFolder,
  onRenameFolder,
  onRemoveFolder,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [foldedAway, setFoldedAway] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmingFolder, setConfirmingFolder] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;

  const wanted = folded(query.trim());
  const sections = useMemo(
    () => sectionsOf(conversations, folders, (chat) => !wanted || folded(chat.title).includes(wanted), Boolean(wanted), foldedAway),
    [conversations, folders, wanted, foldedAway],
  );
  const shown = useMemo(() => visibleChats(sections), [sections]);
  const position = useMemo(() => new Map(shown.map((chat, index) => [chat.id, index])), [shown]);

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
    setMoving(null);
    setAdding(false);
    setRenaming(null);
    setConfirmingFolder(null);
    setProblem(null);
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

  /** A folder's name box: Enter and Escape belong to it, not to the list around it. */
  function nameKeys(cancel: () => void) {
    return (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
  }

  /** Runs a folder action and says why it failed, in the list, instead of closing it. */
  async function attempt(action: () => Promise<void>): Promise<boolean> {
    setProblem(null);
    try {
      await action();
      return true;
    } catch (error) {
      setProblem(errorText(error));
      return false;
    }
  }

  async function remove(conversation: Conversation) {
    setConfirming(null);
    await onDelete(conversation);
  }

  async function moveTo(conversation: Conversation, folderId: string | null) {
    if (await attempt(() => onMove(conversation, folderId))) setMoving(null);
  }

  async function createAndMove(event: FormEvent, conversation: Conversation) {
    event.preventDefault();
    if (
      await attempt(async () => {
        const folder = await onCreateFolder(name);
        await onMove(conversation, folder.id);
      })
    ) {
      setMoving(null);
      setName("");
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      await attempt(async () => {
        await onCreateFolder(name);
      })
    ) {
      setAdding(false);
      setName("");
    }
  }

  async function rename(event: FormEvent, folder: ChatFolder) {
    event.preventDefault();
    if (!renaming) return;
    if (await attempt(() => onRenameFolder(folder, renaming.name))) setRenaming(null);
  }

  async function removeFolder(folder: ChatFolder) {
    setConfirmingFolder(null);
    await attempt(() => onRemoveFolder(folder));
  }

  function toggle(folder: ChatFolder) {
    setFoldedAway((current) => {
      const next = new Set(current);
      if (!next.delete(folder.id)) next.add(folder.id);
      return next;
    });
  }

  function chatRow(conversation: Conversation, filed: boolean) {
    const index = position.get(conversation.id) ?? -1;
    return (
      <li key={conversation.id} role="option" aria-selected={conversation.id === activeId}>
        {confirming === conversation.id ? (
          <div className="convo__confirm">
            <span>¿Eliminar "{conversation.title}"? No se puede deshacer.</span>
            <button type="button" className="ghost-button ghost-button--danger" onClick={() => void remove(conversation)}>ELIMINAR</button>
            <button type="button" className="ghost-button" onClick={() => setConfirming(null)}>NO</button>
          </div>
        ) : moving === conversation.id ? (
          <div className="convo__move">
            <span>Mover "{conversation.title}" a:</span>
            <div className="convo__move-options">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="ghost-button"
                  disabled={folder.id === conversation.folderId}
                  onClick={() => void moveTo(conversation, folder.id)}
                >
                  ▣ {folder.name}
                </button>
              ))}
              {conversation.folderId && (
                <button type="button" className="ghost-button" onClick={() => void moveTo(conversation, null)}>SIN CARPETA</button>
              )}
            </div>
            <form className="convo__name" onSubmit={(event) => void createAndMove(event, conversation)} onKeyDown={nameKeys(() => setMoving(null))}>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="O una carpeta nueva…"
                maxLength={MAX_FOLDER_NAME}
                spellCheck={false}
                aria-label="Nombre de la carpeta nueva"
              />
              <button type="submit" className="ghost-button" disabled={!name.trim()}>CREAR Y MOVER</button>
            </form>
            <button type="button" className="ghost-button" onClick={() => setMoving(null)}>NO</button>
          </div>
        ) : (
          <div
            className={[
              "convo__item",
              filed && "convo__item--filed",
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
              className="convo__act"
              onClick={() => { setProblem(null); setName(""); setMoving(conversation.id); }}
              title="Mover a una carpeta"
              aria-label={`Mover ${conversation.title} a una carpeta`}
            >
              ▣
            </button>
            <button
              type="button"
              className="convo__act convo__act--danger"
              onClick={() => setConfirming(conversation.id)}
              disabled={conversation.status === "running"}
              title={conversation.status === "running" ? "AGENTIX está trabajando; espera a que termine" : "Eliminar conversación"}
              aria-label={`Eliminar ${conversation.title}`}
            >
              ✕
            </button>
          </div>
        )}
      </li>
    );
  }

  function folderRow(folder: ChatFolder, total: number, isFolded: boolean) {
    if (renaming?.id === folder.id) {
      return (
        <li key={`folder-${folder.id}`} role="presentation" className="convo__folder">
          <form className="convo__name" onSubmit={(event) => void rename(event, folder)} onKeyDown={nameKeys(() => setRenaming(null))}>
            <input
              autoFocus
              value={renaming.name}
              onChange={(event) => setRenaming({ id: folder.id, name: event.target.value })}
              maxLength={MAX_FOLDER_NAME}
              spellCheck={false}
              aria-label="Nuevo nombre de la carpeta"
            />
            <button type="submit" className="ghost-button" disabled={!renaming.name.trim()}>GUARDAR</button>
            <button type="button" className="ghost-button" onClick={() => setRenaming(null)}>NO</button>
          </form>
        </li>
      );
    }
    if (confirmingFolder === folder.id) {
      return (
        <li key={`folder-${folder.id}`} role="presentation" className="convo__folder">
          <div className="convo__confirm">
            <span>
              ¿Eliminar la carpeta "{folder.name}"?{" "}
              {total ? "Sus conversaciones no se borran: vuelven a la lista principal." : "Está vacía."}
            </span>
            <button type="button" className="ghost-button ghost-button--danger" onClick={() => void removeFolder(folder)}>ELIMINAR CARPETA</button>
            <button type="button" className="ghost-button" onClick={() => setConfirmingFolder(null)}>NO</button>
          </div>
        </li>
      );
    }
    return (
      <li key={`folder-${folder.id}`} role="presentation" className="convo__folder">
        <div className="convo__folder-row">
          <button type="button" className="convo__folder-toggle" onClick={() => toggle(folder)} aria-expanded={!isFolded} title={folder.name}>
            <span className="convo__caret" aria-hidden="true">{isFolded ? "▸" : "▾"}</span>
            <span className="convo__folder-name">▣ {folder.name}</span>
            <span className="convo__folder-count">{total}</span>
          </button>
          <button
            type="button"
            className="convo__act"
            onClick={() => { setProblem(null); setRenaming({ id: folder.id, name: folder.name }); }}
            title="Cambiar el nombre"
            aria-label={`Cambiar el nombre de ${folder.name}`}
          >
            ✎
          </button>
          <button
            type="button"
            className="convo__act convo__act--danger"
            onClick={() => { setProblem(null); setConfirmingFolder(folder.id); }}
            title="Eliminar carpeta"
            aria-label={`Eliminar la carpeta ${folder.name}`}
          >
            ✕
          </button>
        </div>
      </li>
    );
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
          {problem && <p className="convo__problem" role="alert">! {problem}</p>}
          <ul className="convo__list" role="listbox" aria-label="Conversaciones">
            {sections.map((section) =>
              section.folder ? (
                <Fragment key={section.folder.id}>
                  {folderRow(section.folder, section.total, section.folded)}
                  {section.chats.map((chat) => chatRow(chat, true))}
                </Fragment>
              ) : (
                <Fragment key="loose">
                  {folders.length > 0 && section.total > 0 && (
                    <li role="presentation" className="convo__rule">SIN CARPETA</li>
                  )}
                  {section.chats.map((chat) => chatRow(chat, false))}
                </Fragment>
              ),
            )}
            {!shown.length && !folders.length && (
              <li className="convo__none">{conversations.length ? "Ninguna coincide." : "Sin conversaciones todavía."}</li>
            )}
            {!shown.length && folders.length > 0 && wanted && <li className="convo__none">Ninguna coincide.</li>}
          </ul>
          <div className="convo__foot">
            <button type="button" className="convo__menu-new" onClick={() => { setOpen(false); onNew(); }}>
              + NUEVA CONVERSACIÓN
            </button>
            {adding ? (
              <form className="convo__name convo__name--foot" onSubmit={(event) => void create(event)} onKeyDown={nameKeys(() => setAdding(false))}>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nombre de la carpeta"
                  maxLength={MAX_FOLDER_NAME}
                  spellCheck={false}
                  aria-label="Nombre de la carpeta"
                />
                <button type="submit" className="ghost-button" disabled={!name.trim()}>CREAR</button>
                <button type="button" className="ghost-button" onClick={() => setAdding(false)}>NO</button>
              </form>
            ) : (
              <button type="button" className="convo__menu-new" onClick={() => { setProblem(null); setName(""); setAdding(true); }}>
                + NUEVA CARPETA
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
