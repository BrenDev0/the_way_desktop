import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../src/core/api";
import { textOf, transcript } from "../../src/core/conversations/transcript";

// The shape the server stored for a real desktop conversation.
const messages: ChatMessage[] = [
  { role: "user", content: "can you create a project locally called test_report" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "CreateProject", args: { name: "test_report" } }] },
  { role: "tool", content: "Created project 'test_report'.", toolCallId: "c1" },
  { role: "assistant", content: [{ type: "text", text: "Done — I created the project `test_report`." }] },
  { role: "user", content: "whats the status?" },
  { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "CheckBackgroundTask", args: { task_id: "e9e0" } }] },
];

describe("transcript", () => {
  it("pairs each tool call with its result and folds tool-only steps into the reply", () => {
    const items = transcript(messages);
    expect(items.map((item) => item.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(items[1]).toEqual({
      role: "assistant",
      text: "Done — I created the project `test_report`.",
      tools: [{ id: "c1", name: "CreateProject", args: { name: "test_report" }, result: "Created project 'test_report'." }],
    });
  });

  it("marks a call that has not answered yet", () => {
    expect(transcript(messages)[3].tools[0]).toMatchObject({ name: "CheckBackgroundTask", result: null });
  });

  it("drops the server's working-out and empty steps", () => {
    const items = transcript([{ role: "system", content: "rules" }, { role: "assistant", content: "" }, { role: "user", content: " hola " }]);
    expect(items).toEqual([{ role: "user", text: "hola", tools: [] }]);
  });

  it("reads text from strings and from provider content blocks", () => {
    expect(textOf("  a ")).toBe("a");
    expect(textOf([{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }])).toBe("ab");
    expect(textOf(null)).toBe("");
  });
});
