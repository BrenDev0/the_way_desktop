/** A server-sent event: its type, its (JSON) data, and the id to resume after. */
export interface SseEvent {
  id?: string;
  type: string;
  data: string;
}

/**
 * Turns a text/event-stream, fed in whatever chunks the network delivers, into events.
 * Follows the spec's parts that matter here: "\n", "\r\n" or "\r" line endings, comment
 * lines (the server's keep-alives) ignored, multi-line data joined with "\n", and an event
 * dispatched on the blank line that ends it.
 */
export class SseParser {
  private buffer = "";
  private id: string | undefined;
  private type = "message";
  private data: string[] = [];

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];

    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      // a lone "\r" at the end may be the first half of "\r\n": wait for the next chunk
      if (match[0] === "\r" && match.index === this.buffer.length - 1) break;

      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);

      if (line === "") {
        if (this.data.length) events.push({ id: this.id, type: this.type, data: this.data.join("\n") });
        this.type = "message";
        this.data = [];
        continue;
      }
      if (line.startsWith(":")) continue;

      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") this.data.push(value);
      else if (field === "event") this.type = value;
      else if (field === "id" && !value.includes("\0")) this.id = value;
    }
    return events;
  }
}
