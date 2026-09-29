import { describe, expect, it } from "vitest";
import type { PendingToolCall } from "../../src/core/api";
import { rank, looksLikeNumber, digits } from "../../src/core/tools/browser";
import type { ToolRegistry } from "../../src/core/tools/contract";
import { ToolRunner, type ApprovalDecision, type ApprovalRequest } from "../../src/core/tools/runner";

function call(overrides: Partial<PendingToolCall>): PendingToolCall {
  return { id: "c1", name: "ReadFile", args: {}, location: "desktop", requiresApproval: false, detail: null, ...overrides };
}

class Approvals {
  readonly seen: ApprovalRequest[] = [];
  constructor(private readonly decision: ApprovalDecision = { approved: true }) {}
  async request(request: ApprovalRequest) {
    this.seen.push(request);
    return this.decision;
  }
}

const registry: ToolRegistry = {
  ReadFile: { run: async (args) => `contents of ${args.file_path}` },
  DeleteFile: { run: async () => "deleted", preview: async () => "delete a.txt" },
  Broken: { run: async () => { throw new Error("disk on fire"); } },
};

describe("ToolRunner", () => {
  it("runs a desktop call that needs no approval without asking", async () => {
    const approvals = new Approvals();
    const [resolution] = await new ToolRunner(registry, approvals).resolveAll([call({ args: { file_path: "a.txt" } })]);
    expect(resolution).toEqual({ toolCallId: "c1", approved: true, output: "contents of a.txt" });
    expect(approvals.seen).toEqual([]);
  });

  it("asks before a desktop call that needs approval, with its preview", async () => {
    const approvals = new Approvals();
    const [resolution] = await new ToolRunner(registry, approvals).resolveAll([call({ name: "DeleteFile" })]);
    expect(approvals.seen[0].preview).toBe("delete a.txt");
    expect(resolution.output).toBe("deleted");
  });

  it("asks even when the server forgot the flag, for a tool the app knows is gated", async () => {
    const approvals = new Approvals();
    await new ToolRunner(registry, approvals).resolveAll([call({ name: "DeleteFile", requiresApproval: false })]);
    expect(approvals.seen).toHaveLength(1);
  });

  it("does not run a refused call, and passes the feedback on", async () => {
    let ran = false;
    const runner = new ToolRunner(
      { DeleteFile: { run: async () => { ran = true; return ""; } } },
      new Approvals({ approved: false, feedback: "  archive it instead " }),
    );
    const [resolution] = await runner.resolveAll([call({ name: "DeleteFile", requiresApproval: true })]);
    expect(resolution).toEqual({ toolCallId: "c1", approved: false, feedback: "archive it instead" });
    expect(ran).toBe(false);
  });

  it("reports a failure with the error text", async () => {
    const [resolution] = await new ToolRunner(registry, new Approvals()).resolveAll([call({ name: "Broken" })]);
    expect(resolution).toMatchObject({ approved: true, failed: true, output: "Error: disk on fire" });
  });

  it("answers an unknown desktop tool instead of dropping it", async () => {
    const [resolution] = await new ToolRunner(registry, new Approvals()).resolveAll([call({ name: "Teleport" })]);
    expect(resolution.failed).toBe(true);
    expect(resolution.output).toContain("does not know the tool 'Teleport'");
  });

  it("only asks about a server call -- never runs it or sends output", async () => {
    const approvals = new Approvals({ approved: true });
    const [resolution] = await new ToolRunner(registry, approvals).resolveAll([
      call({ name: "DeleteProjectPath", location: "server", requiresApproval: true }),
    ]);
    expect(resolution).toEqual({ toolCallId: "c1", approved: true });
    expect(approvals.seen).toHaveLength(1);
  });

  it("names the server tools this build lacks", () => {
    expect(new ToolRunner(registry, new Approvals()).missingFrom(["ReadFile", "NewThing"])).toEqual(["NewThing"]);
  });
});

describe("WhatsApp helpers", () => {
  it("treats an exact chat name as the answer, not a candidate", () => {
    expect(rank(["Ana López", "Ana & Beto group", "Familia"], "ana lópez")).toEqual({
      exact: ["Ana López"],
      partial: [],
    });
    expect(rank(["Ana López", "Ana Ruiz"], "Ana").partial).toEqual(["Ana López", "Ana Ruiz"]);
  });

  it("recognises a phone number and refuses a short one", () => {
    expect(looksLikeNumber("+52 1 234 567 890")).toBe(true);
    expect(looksLikeNumber("Ana 2")).toBe(false);
    expect(digits("+52 (123) 456-7890")).toBe("521234567890");
    expect(() => digits("12345")).toThrow(/not a full phone number/);
  });
});
