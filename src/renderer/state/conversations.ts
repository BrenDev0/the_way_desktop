/**
 * The conversation list, shared by the sidebar (which shows it) and the workbench (which
 * loads it and owns what opening, starting and sending a conversation mean). The workbench
 * publishes the list and registers its actions; the sidebar reads and asks.
 */

import { useSyncExternalStore } from "react";
import type { Conversation } from "../../core/api";

interface Snapshot {
  conversations: Conversation[];
  activeId: string | null;
}

interface Actions {
  open(conversation: Conversation): void;
  startNew(): void;
}

let snapshot: Snapshot = { conversations: [], activeId: null };
let actions: Actions | null = null;
const listeners = new Set<() => void>();

export const conversationStore = {
  publish(next: Partial<Snapshot>) {
    if (Object.entries(next).every(([key, value]) => snapshot[key as keyof Snapshot] === value)) return;
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  },
  register(next: Actions): () => void {
    actions = next;
    return () => {
      if (actions === next) actions = null;
    };
  },
  open(conversation: Conversation) {
    actions?.open(conversation);
  },
  startNew() {
    actions?.startNew();
  },
  clear() {
    conversationStore.publish({ conversations: [], activeId: null });
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConversations(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}
