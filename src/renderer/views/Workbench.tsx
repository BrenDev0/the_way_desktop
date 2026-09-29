import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatMessage, Conversation, DesktopUser } from "../../core/api";
import type { ApprovalPrompt } from "../../core/bridge";
import { transcript } from "../../core/conversations/transcript";
import type { ProjectRef } from "../../core/tools/ports";
import { ApprovalDialog } from "./ApprovalDialog";
import { ToolCard } from "./chat/ToolCard";
import { FilesPanel, type FilesTab } from "./files/FilesPanel";
import { errorText } from "./files/helpers";
import "./workbench.css";

interface Props {
  user: DesktopUser;
  onSignOut(): void;
}

const STATUS: Record<Conversation["status"], string> = {
  idle: "LISTO",
  running: "EL AGENTE ESTÁ TRABAJANDO...",
  awaiting_client: "ESPERANDO ESTE EQUIPO",
  failed: "EL ÚLTIMO TURNO FALLÓ",
};

/** Conversations, the chat, the working folder, and the approvals the agent asks for. */
export function Workbench({ user, onSignOut }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [missingTools, setMissingTools] = useState<string[]>([]);
  const [approvals, setApprovals] = useState<ApprovalPrompt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [project, setProject] = useState<ProjectRef | null>(null);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(true);
  const [filesTab, setFilesTab] = useState<FilesTab>("local");
  // bumped when a turn ends: the agent may have written to the folder
  const [localRefresh, setLocalRefresh] = useState(0);
  // true while the server cannot be reached (it restarts on every backend change in development)
  const [offline, setOffline] = useState(false);
  // the reply as the model writes it, until its full message arrives
  const [live, setLive] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const refreshList = useCallback(async () => {
    setConversations(await window.desktop.conversations.list());
  }, []);

  const refreshProjects = useCallback(async () => {
    setProjects(await window.desktop.projects.list());
  }, []);

  const refreshMessages = useCallback(async (id: string) => {
    setMessages(await window.desktop.conversations.messages(id));
  }, []);

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
        await Promise.all([refreshList(), refreshProjects()]);
        if (cancelled) return;
        setOffline(false);
        setProjectError(null);
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
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshList, refreshProjects, refreshMessages]);

  useEffect(() => {
    const offUpdate = window.desktop.conversations.onUpdate((conversation) => {
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
      if (conversationId === activeRef.current) setLive((current) => current + text);
    });
    // Each message the turn adds joins the thread as it lands -- the assistant's text and
    // tool calls, then each tool's result -- so tool cards fill in while the turn runs.
    const offActivity = window.desktop.conversations.onActivity(({ conversationId, message }) => {
      if (conversationId !== activeRef.current || !message) return;
      setMessages((current) => [...current, message]);
      if (message.role === "assistant") setLive("");
    });
    const offApproval = window.desktop.approvals.onRequest((prompt) => setApprovals((queue) => [...queue, prompt]));
    return () => {
      offUpdate();
      offText();
      offActivity();
      offApproval();
    };
  }, [refreshMessages, afterTurn]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, status?.status, live]);

  async function open(conversation: Conversation) {
    setLive("");
    setActiveId(conversation.id);
    setStatus(conversation);
    setError(null);
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

  async function startNew() {
    const created = await window.desktop.conversations.create("Nueva conversación");
    await refreshList();
    await open(created);
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    let id = activeId;
    if (!id) {
      const created = await window.desktop.conversations.create(text.slice(0, 60));
      id = created.id;
      setActiveId(id);
      await refreshList();
    }

    setDraft("");
    setLive("");
    setSending(true);
    setError(null);
    setMessages((current) => [...current, { role: "user", content: text }]);
    try {
      const finished = await window.desktop.conversations.send(id, text);
      setStatus(finished);
      if (finished.status === "failed") setError("El agente no pudo terminar este turno.");
    } catch (reason) {
      setError(sendError(reason));
    } finally {
      setSending(false);
      await refreshMessages(id).catch(() => {});
      void refreshList().catch(() => {});
      afterTurn();
    }
  }

  function openProject(target: ProjectRef) {
    setProject(target);
    setFilesTab("project");
    setFilesOpen(true);
  }

  async function createProject() {
    const name = newProject?.trim();
    setNewProject(null);
    if (!name) return;
    setProjectError(null);
    try {
      const created = await window.desktop.projects.create(name);
      await refreshProjects();
      openProject(created);
    } catch (reason) {
      setProjectError(errorText(reason));
    }
  }

  async function chooseFolder() {
    setFolder(await window.desktop.workspace.choose());
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function answer(approved: boolean, feedback: string) {
    const [current] = approvals;
    if (!current) return;
    setApprovals((queue) => queue.slice(1));
    await window.desktop.approvals.respond(current.id, { approved, feedback });
  }

  const pendingNames = status?.pendingToolCalls.map((call) => call.name) ?? [];

  return (
    <div className={filesOpen ? "workbench workbench--files" : "workbench"}>
      <aside className="workbench__threads">
        <button type="button" className="connect-button workbench__new" onClick={() => void startNew()}>
          NUEVA <span aria-hidden="true">+</span>
        </button>
        <span className="workbench__label">CONVERSACIONES</span>
        <ul className="workbench__list">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                className={conversation.id === activeId ? "thread thread--active" : "thread"}
                onClick={() => void open(conversation)}
              >
                <span className="thread__title">{conversation.title}</span>
                <span className={`thread__status thread__status--${conversation.status}`}>{STATUS[conversation.status]}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="workbench__label workbench__label--row">
          <span>PROYECTOS</span>
          <button type="button" className="workbench__add" onClick={() => setNewProject("")} aria-label="Nuevo proyecto" title="Nuevo proyecto">+</button>
        </div>
        <ul className="workbench__list workbench__list--projects">
          {newProject !== null && (
            <li>
              <input
                className="tree__input workbench__project-input"
                autoFocus
                aria-label="Nombre del proyecto"
                placeholder="Nombre del proyecto"
                value={newProject}
                onChange={(event) => setNewProject(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createProject();
                  if (event.key === "Escape") setNewProject(null);
                }}
                onBlur={() => setNewProject(null)}
              />
            </li>
          )}
          {projects.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === project?.id && filesOpen && filesTab === "project" ? "thread thread--active" : "thread"}
                onClick={() => openProject(item)}
              >
                <span className="thread__title">▣ {item.name}</span>
              </button>
            </li>
          ))}
          {!projects.length && newProject === null && <li className="workbench__none">Sin proyectos todavía.</li>}
        </ul>
        {projectError && <p className="workbench__error" role="alert">{projectError}</p>}
        <div className="workbench__account">
          <span className="selectable">{user.email}</span>
          <button type="button" className="ghost-button" onClick={onSignOut}>SALIR</button>
        </div>
      </aside>

      <section className="chat" aria-label="Conversación">
        <header className="chat__bar">
          <button type="button" className="ghost-button" onClick={() => void chooseFolder()}>
            ▣ {folder ? "CAMBIAR CARPETA" : "ELEGIR CARPETA"}
          </button>
          <span className="chat__folder selectable" title={folder ?? undefined}>
            {folder ?? "Sin carpeta: el agente no podrá leer ni escribir archivos de este equipo."}
          </span>
          {!filesOpen && (
            <button type="button" className="ghost-button chat__files-toggle" onClick={() => setFilesOpen(true)}>ARCHIVOS ◧</button>
          )}
        </header>

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
                  {item.tools.map((tool) => <ToolCard key={tool.id} tool={tool} waiting={sending} />)}
                </div>
              )}
              {item.text && <p className="selectable">{item.text}</p>}
            </article>
          ))}
          {live && (
            <article className="bubble bubble--assistant bubble--live" aria-live="polite">
              <p className="selectable">{live}</p>
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

        <div className="chat__status" role="status" aria-live="polite">
          {sending && <span className="topbar__pulse" />}
          {status ? STATUS[status.status] : "LISTO"}
          {pendingNames.length > 0 && <span className="chat__pending">· {pendingNames.join(", ")}</span>}
          {error && <span className="chat__error">{error}</span>}
        </div>

        <form className="chat__composer" onSubmit={send}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="Escribe un mensaje... (Enter para enviar, Shift+Enter para nueva línea)"
            rows={2}
            disabled={sending}
          />
          <button type="submit" className="connect-button" disabled={sending || !draft.trim()}>
            ENVIAR <span aria-hidden="true">↗</span>
          </button>
        </form>
      </section>

      {filesOpen && (
        <FilesPanel
          folder={folder}
          projects={projects}
          project={project}
          tab={filesTab}
          localRefresh={localRefresh}
          serverRefresh={localRefresh}
          onTab={setFilesTab}
          onChooseFolder={() => void chooseFolder()}
          onClose={() => setFilesOpen(false)}
        />
      )}

      {approvals[0] && <ApprovalDialog prompt={approvals[0]} onAnswer={(ok, feedback) => void answer(ok, feedback)} />}
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
