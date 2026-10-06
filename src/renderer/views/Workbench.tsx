import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import type { Attachment, ChatMessage, Conversation, DesktopUser, TurnPause } from "../../core/api";
import { pauseText, retryHint } from "../../core/conversations/pause";
import type { ApprovalPrompt, ThemeChoice, WorkingPlace } from "../../core/bridge";
import { useAppearance } from "../appearance";
import { Logo } from "../Logo";
import { transcript } from "../../core/conversations/transcript";
import type { ProjectRef } from "../../core/tools/ports";
import { ApprovalDialog } from "./ApprovalDialog";
import { ConversationPicker } from "./chat/ConversationPicker";
import { WorkPlacePicker } from "./chat/WorkPlacePicker";
import { Markdown } from "./chat/Markdown";
import { ToolCard, type OpenTarget } from "./chat/ToolCard";
import { FileChips, type ViewRequest } from "./files/FileChips";
import { FileViewer } from "./files/FileViewer";
import { FilesPanel, type FilesTab } from "./files/FilesPanel";
import type { RemoteFocus } from "./files/RemoteFilesTab";
import { errorText } from "./files/helpers";
import { conversationStore } from "../state/conversations";
import { useVoice } from "../voice/useVoice";
import "./workbench.css";

interface Props {
  user: DesktopUser;
  /** Whether the server answers -- shown under the files. */
  connected: boolean;
  onSignOut(): void;
}

const STATUS: Record<Conversation["status"], string> = {
  idle: "LISTO",
  running: "EL AGENTE ESTÁ TRABAJANDO...",
  awaiting_client: "ESPERANDO ESTE EQUIPO",
  paused: "TURNO EN PAUSA",
  failed: "EL ÚLTIMO TURNO FALLÓ",
};

const THEMES: [ThemeChoice, string, string][] = [
  ["dark", "OSCURO", "Tema oscuro"],
  ["light", "CLARO", "Tema claro"],
  ["system", "SISTEMA", "Como esté Windows: cambia solo cuando Windows cambia"],
];

/** A task's icon, on its way from the chat to the strip on the screen edge. */
interface Launch {
  id: string;
  from: { x: number; y: number };
}

/** How long the flight takes; the strip's icon lands as it ends (dock.css). */
const LAUNCH_MS = 700;

/**
 * The signed-in workspace: files on the left (the open folder and the user's projects) and
 * the chat. Background tasks fly out of the chat to icons on the screen edge, a window of
 * their own (dock/Dock.tsx). Conversations are picked by the message box (chat/ConversationPicker), and the left
 * column carries the logo, the account and the server's state.
 */
export function Workbench({ user, connected, onSignOut }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const { appearance, choose: chooseTheme } = useAppearance();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // a turn under way that this window did not send -- the agent reporting a finished task
  const serverTurn = !sending && (status?.status === "running" || status?.status === "awaiting_client");
  const [folder, setFolder] = useState<string | null>(null);
  // where the agent works: the local folder above, or a project folder on the server
  const [place, setPlace] = useState<WorkingPlace>({ mode: "local", local: null, remote: null });
  const [missingTools, setMissingTools] = useState<string[]>([]);
  const [approvals, setApprovals] = useState<ApprovalPrompt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [filesTab, setFilesTab] = useState<FilesTab>("local");
  // a task's delivered folder, shown in the remote tree
  const [focus, setFocus] = useState<RemoteFocus | null>(null);
  // in a small window the files column becomes an overlay, opened from the chat bar
  const [overlay, setOverlay] = useState<"files" | null>(null);
  const [launches, setLaunches] = useState<Launch[]>([]);
  // the file open in the viewer, if any
  const [viewing, setViewing] = useState<ViewRequest | null>(null);
  // auto mode: everything approved without asking, except images
  const [autoOn, setAutoOn] = useState(false);
  useEffect(() => {
    void window.desktop.approvals.auto().then(setAutoOn).catch(() => {});
    return window.desktop.approvals.onAutoChanged(setAutoOn);
  }, []);
  // files attached to the message being written, uploading or ready to send
  const [attached, setAttached] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = attached.some((item) => item.status === "uploading");
  const readyFiles = attached.flatMap((item) => (item.status === "ready" && item.attachment ? [item.attachment] : []));
  const closeViewer = useCallback(() => setViewing(null), []);
  const composer = useRef<HTMLFormElement>(null);
  // bumped when a turn ends: the agent may have written to the folder
  const [localRefresh, setLocalRefresh] = useState(0);
  // true while the server cannot be reached (it restarts on every backend change in development)
  const [offline, setOffline] = useState(false);
  // the reply as the model writes it, until its full message arrives
  const [live, setLive] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  // what was said is sent as it is, the way a typed line is on Enter
  const voice = useVoice({ onTranscript: (text) => void submit(text, true) });
  const { replyText } = voice;

  const refreshList = useCallback(async () => {
    setConversations(await window.desktop.conversations.list());
  }, []);

  const refreshProjects = useCallback(async () => {
    setProjects(await window.desktop.projects.list());
  }, []);

  const refreshMessages = useCallback(async (id: string) => {
    setMessages(await window.desktop.conversations.messages(id));
  }, []);

  useEffect(() => {
    conversationStore.publish({ conversations, activeId });
  }, [conversations, activeId]);

  /** After a turn: the agent may have written local files or created projects and files on the server. */
  const afterTurn = useCallback(() => {
    setLocalRefresh((n) => n + 1);
    void refreshProjects().catch(() => {});
  }, [refreshProjects]);

  // The first load waits out a server that is restarting instead of leaving the tab empty.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function attempt(tries: number) {
      try {
        // reading the task list is also what starts following running tasks for the strip
        await Promise.all([refreshList(), refreshProjects(), window.desktop.tasks.list()]);
        if (cancelled) return;
        setOffline(false);
        void window.desktop.tools.check().then((check) => setMissingTools(check.missing)).catch(() => {});
        if (activeRef.current) void refreshMessages(activeRef.current).catch(() => {});
      } catch {
        if (cancelled) return;
        setOffline(true);
        timer = setTimeout(() => void attempt(tries + 1), Math.min(2000 * 2 ** tries, 15000));
      }
    }
    void attempt(0);
    void window.desktop.workspace.current().then(setFolder);
    void window.desktop.workspace.place().then(setPlace).catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshList, refreshProjects, refreshMessages]);

  useEffect(() => {
    const offUpdate = window.desktop.conversations.onUpdate((conversation) => {
      // the list shows its title, which the server sets after the first reply
      setConversations((list) => list.map((item) => (item.id === conversation.id ? { ...item, ...conversation } : item)));
      if (conversation.id !== activeRef.current) return;
      setStatus(conversation);
      // a pause means new tool calls were just added to the thread
      if (conversation.status !== "running") {
        setLive("");
        void refreshMessages(conversation.id).catch(() => {});
        afterTurn();
      }
    });
    const offText = window.desktop.conversations.onText(({ conversationId, text }) => {
      if (conversationId !== activeRef.current) return;
      setLive((current) => current + text);
      replyText(text);
    });
    // Each message the turn adds joins the thread as it lands -- the assistant's text and
    // tool calls, then each tool's result -- so tool cards fill in while the turn runs.
    const offActivity = window.desktop.conversations.onActivity(({ conversationId, message }) => {
      if (conversationId !== activeRef.current || !message) return;
      setMessages((current) => [...current, message]);
      if (message.role === "assistant") setLive("");
    });
    const offApproval = window.desktop.approvals.onRequest((prompt) => setApprovals((queue) => [...queue, prompt]));
    // answered by auto mode while on screen
    const offSettled = window.desktop.approvals.onSettled((ids) => setApprovals((queue) => queue.filter((prompt) => !ids.includes(prompt.id))));
    return () => {
      offUpdate();
      offText();
      offActivity();
      offApproval();
      offSettled();
    };
  }, [refreshMessages, afterTurn, replyText]);

  // A task that starts while the app is open leaves from the composer and flies to the edge.
  // Tasks already running at start-up are not new, so the first list only sets the baseline.
  useEffect(() => {
    let known: Set<string> | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = window.desktop.tasks.onChanged((tasks) => {
      const fresh = known ? tasks.filter((task) => task.status === "running" && !known!.has(task.id)) : [];
      known = new Set([...(known ?? []), ...tasks.map((task) => task.id)]);
      const box = composer.current?.getBoundingClientRect();
      if (!fresh.length || !box || document.hidden) return;
      const from = { x: box.left + box.width / 2, y: box.top };
      setLaunches((current) => [...current, ...fresh.map((task) => ({ id: task.id, from }))]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setLaunches((current) => current.filter((launch) => !fresh.some((task) => task.id === launch.id)));
      }, LAUNCH_MS);
      timers.add(timer);
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, []);

  // The strip's "files", "conversation" and file buttons bring the app forward and land here.
  const dockActions = useRef({ openDelivery, openConversationById, openFile });
  dockActions.current = { openDelivery, openConversationById, openFile };
  useEffect(() => {
    const offProject = window.desktop.dock.onOpenProject(({ name, path }) => void dockActions.current.openDelivery(name, path));
    const offConversation = window.desktop.dock.onOpenConversation((id) => dockActions.current.openConversationById(id));
    const offShow = window.desktop.viewer.onShow((target) => dockActions.current.openFile(target));
    return () => {
      offProject();
      offConversation();
      offShow();
    };
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, status?.status, live]);

  async function open(conversation: Conversation) {
    setLive("");
    setActiveId(conversation.id);
    setStatus(conversation);
    setError(null);
    refocus();
    try {
      await refreshMessages(conversation.id);
    } catch (reason) {
      setMessages([]);
      setError(errorText(reason).includes("conectar") ? "Sin conexión con el servidor." : "No se pudo abrir la conversación.");
      return;
    }
    // a conversation left mid-turn (the app closed while it was paused) carries on here
    if (conversation.status === "running" || conversation.status === "awaiting_client") {
      setSending(true);
      try {
        setStatus(await window.desktop.conversations.resume(conversation.id));
        await refreshMessages(conversation.id);
      } catch {
        setError("No se pudo retomar la conversación.");
      } finally {
        setSending(false);
        afterTurn();
      }
    }
  }

  // Anything that opens or starts a conversation asks through the store; the latest open/startNew answer it.
  const actions = useRef({ open, startNew });
  actions.current = { open, startNew };
  useEffect(() => conversationStore.register({
    open: (conversation) => void actions.current.open(conversation),
    startNew: () => void actions.current.startNew(),
  }), []);

  async function startNew() {
    const created = await window.desktop.conversations.create("Nueva conversación");
    await refreshList();
    await open(created);
  }

  /** From the picker. The one on screen going away leaves an empty chat, ready for a new one. */
  async function removeConversation(conversation: Conversation) {
    try {
      await window.desktop.conversations.remove(conversation.id);
    } catch {
      setError("No se pudo eliminar la conversación.");
      return;
    }
    if (conversation.id === activeRef.current) {
      setActiveId(null);
      setStatus(null);
      setMessages([]);
      setLive("");
      refocus();
    }
    await refreshList().catch(() => {});
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    await submit(draft.trim(), false);
  }

  /** Files picked, dropped or pasted: each starts uploading to the server at once, so it
   *  is ready by the time the message is. */
  function addFiles(files: File[]) {
    const room = MAX_ATTACHMENTS - attached.length;
    if (files.length > room) setError(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos por mensaje.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const name = attachmentName(file);
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttached((current) => [...current, { key, name, status: "failed", error: "Supera los 25 MB" }]);
        continue;
      }
      setAttached((current) => [...current, { key, name, status: "uploading" }]);
      void file
        .arrayBuffer()
        .then((buffer) => window.desktop.conversations.attach(name, file.type || guessType(name), new Uint8Array(buffer)))
        .then((attachment) => setAttached((current) => current.map((item) => (item.key === key ? { ...item, status: "ready", attachment } : item))))
        .catch(() => setAttached((current) => current.map((item) => (item.key === key ? { ...item, status: "failed", error: "No se pudo subir" } : item))));
    }
  }

  function removeAttached(key: string) {
    setAttached((current) => current.filter((item) => item.key !== key));
  }

  /** Sends a line, typed or spoken, with whatever files are attached. With voice on, the
   *  reply is spoken as it is written. */
  async function submit(text: string, spoken: boolean) {
    const files = readyFiles;
    if (!text && !files.length) return;
    if (uploading) {
      // the message is about those files: it waits for them rather than going without
      if (spoken) setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
      setError("Espera a que terminen de subir los archivos adjuntos.");
      return;
    }
    // busy with a reply the user asked for, or one the agent started itself (a finished
    // background task being reported): the next message waits in the box until it ends
    if (sending || serverTurn) {
      // still answering the last one: keep what was said rather than lose it
      if (spoken) setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
      return;
    }

    let id = activeId;
    if (!id) {
      // the placeholder, not the message: the server names a conversation after its first
      // exchange only while it still has one, and the new title arrives with the reply
      const created = await window.desktop.conversations.create("Nueva conversación");
      id = created.id;
      setActiveId(id);
      await refreshList();
    }

    // a spoken line leaves whatever was being typed where it was
    if (!spoken) setDraft("");
    setLive("");
    setSending(true);
    setError(null);
    setMessages((current) => [...current, { role: "user", content: files.length ? withAttachments(text, files) : text }]);
    // the files go with this message; a failed send puts them back to try again
    const sentItems = attached.filter((item) => item.status === "ready");
    setAttached((current) => current.filter((item) => item.status !== "ready"));
    // clicking ENVIAR moved the cursor onto the button; it belongs back in the box
    refocus();
    voice.beginReply();
    try {
      const finished = await window.desktop.conversations.send(id, text, voice.on, files.map((file) => file.fileId));
      setStatus(finished);
      if (finished.status === "failed") setError("El agente no pudo terminar este turno.");
    } catch (reason) {
      setError(sendError(reason));
      setAttached((current) => [...sentItems, ...current]);
    } finally {
      voice.endReply();
      setSending(false);
      refocus();
      await refreshMessages(id).catch(() => {});
      void refreshList().catch(() => {});
      afterTurn();
    }
  }

  /** REANUDAR on a paused turn: the server carries on from its last step, and this follows
   *  it to its end like a sent message. It may pause again (the limit has not lifted yet). */
  async function retry() {
    const id = activeRef.current;
    if (!id || sending) return;
    setLive("");
    setSending(true);
    setError(null);
    try {
      const finished = await window.desktop.conversations.retry(id);
      setStatus(finished);
      if (finished.status === "failed") setError("El agente no pudo terminar este turno.");
    } catch (reason) {
      setError(sendError(reason));
    } finally {
      setSending(false);
      refocus();
      await refreshMessages(id).catch(() => {});
      void refreshList().catch(() => {});
      afterTurn();
    }
  }

  /** "Ver archivos" on a finished task: the remote tree, at the folder it delivered to. */
  async function openDelivery(name: string, path: string | null) {
    if (!projects.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      setProjects(await window.desktop.projects.list().catch(() => projects));
    }
    setFocus({ project: name, path });
    setFilesTab("remote");
    setOverlay("files");
  }

  /** A file the agent made: into the viewer. A delivered folder: the files panel, there. */
  function openFile(target: OpenTarget) {
    if ("local" in target) setViewing({ source: "local", path: target.local });
    else if (target.kind === "folder") void openDelivery(target.project, target.path);
    else setViewing({ source: "project", project: target.project, path: target.path });
  }

  function openConversationById(id: string) {
    const found = conversations.find((conversation) => conversation.id === id);
    if (found) void open(found);
    setOverlay(null);
  }

  async function chooseFolder() {
    setFolder(await window.desktop.workspace.choose());
    setPlace(await window.desktop.workspace.place());
  }

  /** A project ("" path) or a folder in one becomes where the agent works -- from the
   *  picker by the message box, or TRABAJAR AQUÍ in the projects tree. */
  async function workRemotely(project: string, path: string) {
    setPlace(await window.desktop.workspace.setRemote(project, path));
  }

  /**
   * Puts the cursor back in the message box -- once a reply is in, or a conversation is
   * opened -- unless the user is busy somewhere else: renaming a file, answering an
   * approval, looking at a file, or typing in another field.
   */
  const refocus = useCallback(() => {
    requestAnimationFrame(() => {
      const box = composerInput.current;
      const active = document.activeElement;
      const elsewhere = active instanceof HTMLInputElement || active instanceof HTMLSelectElement
        || (active instanceof HTMLTextAreaElement && active !== box);
      if (!box || elsewhere || document.querySelector(".approval, .viewer")) return;
      box.focus();
    });
  }, []);

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function answer(approved: boolean, feedback: string, args?: Record<string, string>) {
    const [current] = approvals;
    if (!current) return;
    setApprovals((queue) => queue.slice(1));
    await window.desktop.approvals.respond(current.id, { approved, feedback, args });
  }

  const pendingNames = status?.pendingToolCalls.map((call) => call.name) ?? [];

  return (
    <div className={overlay ? `workbench workbench--${overlay}` : "workbench"}>
      {/* The left column: who this is, their files, and whether the server answers. */}
      <div className="workbench__files">
        <div className="rail__brand">
          <Logo />
          <span>DESKTOP / OPERADOR</span>
        </div>
        <FilesPanel
          folder={folder}
          projects={projects}
          tab={filesTab}
          localRefresh={localRefresh}
          serverRefresh={localRefresh}
          focus={focus}
          onTab={setFilesTab}
          onChooseFolder={() => void chooseFolder()}
          onProjectsChanged={refreshProjects}
          onView={setViewing}
          workingRemote={place.mode === "remote" ? place.remote : null}
          onWorkHere={workRemotely}
          onClose={overlay === "files" ? () => setOverlay(null) : undefined}
        />
        <div className="rail__bottom">
          <div className="rail__account">
            <span className="selectable" title={user.email}>{user.email}</span>
            <button type="button" className="ghost-button" onClick={onSignOut}>SALIR</button>
          </div>
          <div className="theme-switch" role="group" aria-label="Tema">
            {THEMES.map(([theme, label, hint]) => (
              <button
                key={theme}
                type="button"
                aria-pressed={appearance?.theme === theme}
                title={hint}
                onClick={() => void chooseTheme(theme).catch(() => {})}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="rail__status">
            <span className={connected ? "dot dot--on" : "dot"} />
            <span>{connected ? "SERVIDOR CONECTADO" : "SERVIDOR SIN CONEXIÓN"}</span>
          </div>
        </div>
      </div>

      <section
        className={dragging ? "chat chat--dragging" : "chat"}
        aria-label="Conversación"
        // files dropped anywhere on the chat are attached to the message being written
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
          refocus();
        }}
      >
        {autoOn && (
          <p className="chat__notice chat__notice--auto" role="status">
            MODO AUTO · el agente modifica y mueve archivos, envía mensajes y usa el navegador sin preguntarte. Solo te pedirá permiso para eliminar algo y para generar imágenes.
          </p>
        )}
        {offline && (
          <p className="chat__notice" role="status">Sin conexión con el servidor. Reintentando…</p>
        )}
        {!user.setupComplete && (
          <p className="chat__notice">Tu cuenta aún no tiene una clave de IA. Pide a un administrador que te la asigne.</p>
        )}
        {missingTools.length > 0 && (
          <p className="chat__notice">Esta versión no incluye algunas herramientas del servidor ({missingTools.join(", ")}). Actualiza la aplicación.</p>
        )}

        <div className="chat__log">
          {transcript(messages).map((item, index) => (
            <article key={index} className={`bubble bubble--${item.role}`}>
              {item.tools.length > 0 && (
                <div className="bubble__tools">
                  {item.tools.map((tool) => <ToolCard key={tool.id} tool={tool} waiting={sending} onOpenFile={openFile} />)}
                </div>
              )}
              {item.text && (item.role === "assistant" ? <Markdown text={item.text} /> : <p className="selectable">{item.text}</p>)}
              {item.attachments.length > 0 && (
                <FileChips
                  files={item.attachments.map((file) => ({ project: file.project, path: file.path, kind: "file" as const }))}
                  onOpen={openFile}
                />
              )}
            </article>
          ))}
          {live && (
            <article className="bubble bubble--assistant bubble--live" aria-live="polite">
              <Markdown text={live} />
            </article>
          )}
          {!messages.length && !live && (
            <div className="chat__empty">
              <p className="eyebrow"><span className="eyebrow__line" /> EL CAMINO COMIENZA AQUÍ</p>
              <p>Pide lo que necesites. El agente trabaja en el servidor y usa este equipo solo con tu permiso.</p>
            </div>
          )}
          <div ref={bottom} />
        </div>

        {status?.status === "paused" && !sending && <PauseBanner pause={status.pause} onRetry={() => void retry()} />}

        <div className="chat__status" role="status" aria-live="polite">
          {sending && <span className="topbar__pulse" />}
          {status ? STATUS[status.status] : "LISTO"}
          {pendingNames.length > 0 && <span className="chat__pending">· {pendingNames.join(", ")}</span>}
          {voice.recording && <span className="chat__voice chat__voice--live">● ESCUCHANDO</span>}
          {voice.transcribing && <span className="chat__voice">TRANSCRIBIENDO…</span>}
          {voice.speaking && (
            <button type="button" className="chat__voice chat__voice-stop" onClick={voice.silence}>
              ■ DETENER VOZ
            </button>
          )}
          {(error ?? voice.error) && <span className="chat__error">{error ?? voice.error}</span>}
        </div>

        {/* Where this message goes and how: the conversation, the folder on this computer
            the agent works in, and whether it asks before acting -- right by the box. */}
        <div className="chat__convo">
          <ConversationPicker
            conversations={conversations}
            activeId={activeId}
            onOpen={(conversation) => void open(conversation)}
            onNew={() => void startNew()}
            onDelete={removeConversation}
          />
          <WorkPlacePicker
            place={place}
            projects={projects}
            onChooseLocal={chooseFolder}
            onUse={async (mode) => setPlace(await window.desktop.workspace.use(mode))}
            onSetRemote={async (project, path) => {
              await workRemotely(project, path);
              // show where the agent will now work, in the projects tree
              setFocus({ project, path: path || null });
              setFilesTab("remote");
            }}
          />
          <span className="chat__toggles">
            <button
              type="button"
              className={autoOn ? "ghost-button chat__auto chat__auto--on" : "ghost-button chat__auto"}
              onClick={() => void window.desktop.approvals.setAuto(!autoOn).then(setAutoOn)}
              aria-pressed={autoOn}
              title={autoOn
                ? "Modo auto activo: el agente actúa sin pedir permiso, salvo para eliminar y generar imágenes. Clic para volver a preguntar."
                : "Modo auto: aprobar todo sin preguntar, salvo eliminar y generar imágenes. Se apaga al cerrar la app."}
            >
              {autoOn ? "⚡ AUTO ON" : "AUTO OFF"}
            </button>
            <button type="button" className="ghost-button chat__toggle chat__toggle--files" onClick={() => setOverlay((o) => (o === "files" ? null : "files"))} aria-pressed={overlay === "files"}>◧ ARCHIVOS</button>
          </span>
        </div>
        {attached.length > 0 && <AttachmentTray items={attached} onRemove={removeAttached} />}
        <form ref={composer} className="chat__composer" onSubmit={send}>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              // the same file can be picked again after being removed
              event.target.value = "";
              refocus();
            }}
          />
          <button
            type="button"
            className="ghost-button chat__attach"
            onClick={() => picker.current?.click()}
            title="Adjuntar una imagen, un PDF u otro archivo (también puedes arrastrarlos aquí o pegar una imagen)"
            aria-label="Adjuntar archivos"
          >
            ＋
          </button>
          {/* Never disabled: a disabled box loses the cursor, and the next message can be
              written while the agent is still on this one -- it is sent once the turn ends. */}
          <textarea
            ref={composerInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onPaste={(event) => {
              // a screenshot pasted into the box is attached, not lost
              const files = Array.from(event.clipboardData.files);
              if (!files.length) return;
              event.preventDefault();
              addFiles(files);
            }}
            placeholder={sending
              ? "El agente está trabajando… puedes ir escribiendo el siguiente mensaje"
              : "Escribe un mensaje…  (Shift+Enter: nueva línea · mantén Ctrl+M para hablar)"}
            rows={2}
            autoFocus
          />
          <div className="chat__voice-controls">
            <button
              type="button"
              className={voice.recording ? "chat__mic chat__mic--live" : "chat__mic"}
              onClick={voice.toggleRecording}
              disabled={voice.transcribing}
              aria-pressed={voice.recording}
              title={voice.recording ? "Clic para enviar lo que dijiste" : "Clic para hablar (o mantén Ctrl+M)"}
            >
              <MicIcon /> {voice.recording ? "ENVIAR VOZ" : "HABLAR"}
            </button>
            <button
              type="button"
              className="ghost-button chat__voice-toggle"
              onClick={() => void voice.toggle()}
              aria-pressed={voice.on}
              title={voice.on ? "Apagar la voz: cierra el micrófono y deja de leer las respuestas" : "Encender la voz: las respuestas se leen en voz alta"}
            >
              VOZ {voice.on ? "ON" : "OFF"}
            </button>
          </div>
          <button
            type="submit"
            className="chat__send"
            disabled={sending || serverTurn || uploading || (!draft.trim() && !readyFiles.length)}
            aria-label="Enviar"
            title="Enviar (Enter)"
          >
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      </section>

      {launches.map((launch) => (
        <span
          key={launch.id}
          className="task-launch"
          aria-hidden="true"
          style={{ "--from-x": `${launch.from.x}px`, "--from-y": `${launch.from.y}px` } as CSSProperties}
        />
      ))}

      {viewing && <FileViewer request={viewing} onClose={closeViewer} />}
      {approvals[0] && <ApprovalDialog prompt={approvals[0]} onAnswer={(ok, feedback, args) => void answer(ok, feedback, args)} />}
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

// The server's limits for files attached to one message (conversations/config.py).
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** A file attached to the message being written. */
interface PendingAttachment {
  key: string;
  name: string;
  status: "uploading" | "ready" | "failed";
  attachment?: Attachment;
  error?: string;
}

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  html: "text/html", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function guessType(name: string): string {
  return TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** A pasted screenshot arrives as "image.png"; it is given a name worth keeping. */
function attachmentName(file: File): string {
  if (file.name && file.name !== "image.png") return file.name;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `captura-${stamp}.${file.type.split("/")[1] || "png"}`;
}

/** The message as the server stores it, so it shows with its files before it comes back. */
function withAttachments(text: string, files: Attachment[]): unknown[] {
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...files.map((file) => ({
      type: "attachment",
      file_id: file.fileId,
      project: file.project,
      path: file.path,
      name: file.name,
      content_type: file.contentType,
      size_bytes: file.sizeBytes,
    })),
  ];
}

/** The files going with the next message, above the box: each uploading, ready, or failed. */
function AttachmentTray({ items, onRemove }: { items: PendingAttachment[]; onRemove(key: string): void }) {
  return (
    <ul className="chat__attachments" aria-label="Archivos adjuntos">
      {items.map((item) => (
        <li key={item.key} className={`chat__attachment chat__attachment--${item.status}`} title={item.error ?? item.name}>
          <span className="chat__attachment-name">{item.name}</span>
          <span className="chat__attachment-state">
            {item.status === "uploading" ? "SUBIENDO…" : item.status === "failed" ? (item.error ?? "ERROR").toUpperCase() : "LISTO"}
          </span>
          <button type="button" onClick={() => onRemove(item.key)} aria-label={`Quitar ${item.name}`}>×</button>
        </li>
      ))}
    </ul>
  );
}

/** A paused turn: what happened, what to do, and the button that carries it on. Nothing
 *  it did is lost -- the server resumes from its last step. */
function PauseBanner({ pause, onRetry }: { pause: TurnPause | null | undefined; onRetry(): void }) {
  const { title, body } = pauseText(pause);
  const hint = retryHint(pause);
  return (
    <div className="chat__notice chat__pause" role="alert">
      <div className="chat__pause-text">
        <strong>{title}.</strong> {body} {hint}
        {pause?.detail && (pause.reason === "quota" || pause.reason === "credentials") && (
          <span className="chat__pause-detail selectable">{pause.detail}</span>
        )}
        <span className="chat__pause-safe">Todo lo que hizo el agente hasta aquí está guardado.</span>
      </div>
      <button type="button" className="chat__pause-retry" onClick={onRetry}>
        REANUDAR
      </button>
    </div>
  );
}

function sendError(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  if (text.includes("api_key_not_configured") || text.includes("has not been set up")) {
    return "Tu cuenta aún no tiene una clave de IA. Pide a un administrador que te la asigne.";
  }
  if (text.includes("conversation_busy") || text.includes("still working")) return "La conversación sigue trabajando en el mensaje anterior.";
  return "No se pudo enviar el mensaje.";
}
