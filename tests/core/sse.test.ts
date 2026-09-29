import { describe, expect, it } from "vitest";
import { SseParser } from "../../src/core/sse";

describe("SseParser", () => {
  it("reads an event with its id and type", () => {
    const events = new SseParser().feed('id: 1-0\nevent: text\ndata: {"text":"hi"}\n\n');
    expect(events).toEqual([{ id: "1-0", type: "text", data: '{"text":"hi"}' }]);
  });

  it("ignores keep-alive comments", () => {
    expect(new SseParser().feed(": keep-alive\n\n: keep-alive\n\n")).toEqual([]);
  });

  it("puts together an event split across network chunks", () => {
    const parser = new SseParser();
    expect(parser.feed("event: sta")).toEqual([]);
    expect(parser.feed('tus\ndata: {"status"')).toEqual([]);
    expect(parser.feed(':"idle"}\n\n')).toEqual([{ id: undefined, type: "status", data: '{"status":"idle"}' }]);
  });

  it("handles CRLF, including a CR and LF that arrive in different chunks", () => {
    const parser = new SseParser();
    expect(parser.feed("data: a\r")).toEqual([]);
    expect(parser.feed("\n\r\n")).toEqual([{ id: undefined, type: "message", data: "a" }]);
  });

  it("joins multi-line data with newlines", () => {
    expect(new SseParser().feed("data: one\ndata: two\n\n")[0].data).toBe("one\ntwo");
  });

  it("keeps the last id for events that carry none", () => {
    const parser = new SseParser();
    parser.feed("id: 7-0\ndata: x\n\n");
    expect(parser.feed("event: status\ndata: y\n\n")[0].id).toBe("7-0");
  });
});
