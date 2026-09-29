import type { ConversationEventsPort } from "../core/api";
import { SseParser, type SseEvent } from "../core/sse";
import type { ApiClient } from "./apiClient";

/** Reads a conversation's server-sent events off the desktop API, as they arrive. */
export class ConversationEvents implements ConversationEventsPort {
  constructor(private readonly api: ApiClient) {}

  async *open(conversationId: string, lastEventId: string | undefined, signal: AbortSignal): AsyncIterable<SseEvent> {
    const body = await this.api.stream(`/conversations/${conversationId}/events`, lastEventId, signal);
    const reader = body.getReader();
    // stream: true keeps a character split across two network chunks in one piece
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        yield* parser.feed(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }
  }
}
