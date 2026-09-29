import type { Conversation } from "../../core/api";
import { conversationStore, useConversations } from "../state/conversations";

const STATUS: Record<Conversation["status"], string> = {
  idle: "LISTA",
  running: "TRABAJANDO…",
  awaiting_client: "ESPERA A ESTE EQUIPO",
  failed: "FALLÓ",
};

/** The sidebar's chats. Opening or starting one is the workbench's job; this only asks. */
export function ConversationList() {
  const { conversations, activeId } = useConversations();

  return (
    <section className="sidebar__chats" aria-label="Conversaciones">
      <div className="sidebar__chats-head">
        <span>CONVERSACIONES</span>
        <button
          type="button"
          className="sidebar__chats-new"
          onClick={() => conversationStore.startNew()}
          aria-label="Nueva conversación"
          title="Nueva conversación"
        >
          +
        </button>
      </div>
      <ul className="sidebar__chats-list">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              className={conversation.id === activeId ? "chat-link chat-link--active" : "chat-link"}
              onClick={() => conversationStore.open(conversation)}
              title={conversation.title}
            >
              <span className="chat-link__title">{conversation.title}</span>
              <span className={`chat-link__status chat-link__status--${conversation.status}`}>{STATUS[conversation.status]}</span>
            </button>
          </li>
        ))}
        {!conversations.length && <li className="sidebar__chats-none">Sin conversaciones todavía.</li>}
      </ul>
    </section>
  );
}
