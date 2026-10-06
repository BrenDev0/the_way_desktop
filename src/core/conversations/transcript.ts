/**
 * The stored messages of a conversation, shaped for reading: user and assistant turns in
 * order, each assistant turn carrying the tool calls it made and what each returned.
 * Tool results are separate "tool" messages on the server, matched here by toolCallId.
 */

import type { Attachment, ChatMessage } from "../api";

export interface ToolActivity {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** The tool's output, or null while it has not answered yet. */
  result: string | null;
}

export interface TranscriptItem {
  role: "user" | "assistant";
  text: string;
  tools: ToolActivity[];
  /** Files the user attached to this message. */
  attachments: Attachment[];
}

/** The files a message carries. The server stores them as typed blocks beside the text,
 *  in its own (snake_case) shape, since message content is kept as it was sent. */
export function attachmentsOf(content: unknown): Attachment[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): Attachment[] => {
    if (typeof block !== "object" || !block || (block as { type?: unknown }).type !== "attachment") return [];
    const raw = block as Record<string, unknown>;
    return [{
      fileId: String(raw.file_id ?? raw.fileId ?? ""),
      project: String(raw.project ?? ""),
      path: String(raw.path ?? ""),
      name: String(raw.name ?? ""),
      contentType: String(raw.content_type ?? raw.contentType ?? ""),
      sizeBytes: Number(raw.size_bytes ?? raw.sizeBytes ?? 0),
    }];
  });
}

/** Text from a message: OpenAI sends a string, Anthropic a list of typed blocks. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "object" && block && "text" in block ? String((block as { text: unknown }).text) : ""))
      .join("")
      .trim();
  }
  return "";
}

export function transcript(messages: ChatMessage[]): TranscriptItem[] {
  const results = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId) results.set(message.toolCallId, textOf(message.content));
  }

  const items: TranscriptItem[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = textOf(message.content);
    const tools = (message.toolCalls ?? []).map((call) => ({
      id: call.id,
      name: call.name,
      args: call.args ?? {},
      result: results.get(call.id) ?? null,
    }));
    const attachments = message.role === "user" ? attachmentsOf(message.content) : [];
    if (!text && !tools.length && !attachments.length) continue;

    // Tool-only steps join the assistant turn they belong to, so one reply reads as one block.
    const last = items[items.length - 1];
    if (message.role === "assistant" && last?.role === "assistant" && (!last.text || !text)) {
      last.tools.push(...tools);
      if (text) last.text = text;
      continue;
    }
    items.push({ role: message.role, text, tools, attachments });
  }
  return items;
}
