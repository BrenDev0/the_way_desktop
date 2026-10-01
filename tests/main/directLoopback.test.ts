import { describe, expect, it } from "vitest";
import { directLoopback } from "../../src/main/serverConnectionAdapter";

describe("directLoopback", () => {
  it("reaches a server on this machine by its address, not by the name localhost", () => {
    expect(directLoopback("http://localhost:8000")).toBe("http://127.0.0.1:8000");
    expect(directLoopback("http://localhost:8000/")).toBe("http://127.0.0.1:8000");
  });

  it("leaves every other address as it is", () => {
    expect(directLoopback("https://api.example.com")).toBe("https://api.example.com");
    expect(directLoopback("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
    expect(directLoopback("not a url")).toBe("not a url");
  });
});
