import { describe, expect, it } from "vitest";
import type { PendingToolCall } from "../../src/core/api";
import { AutoApprovals, mustAsk } from "../../src/core/tools/autoApprovals";
import type { ApprovalDecision, ApprovalRequest } from "../../src/core/tools/runner";

function call(name: string, overrides: Partial<PendingToolCall> = {}): PendingToolCall {
  return { id: name, name, args: {}, location: "server", requiresApproval: true, detail: null, ...overrides };
}

class Person {
  readonly asked: string[] = [];
  async request({ call }: ApprovalRequest): Promise<ApprovalDecision> {
    this.asked.push(call.name);
    return { approved: false, feedback: "no" };
  }
}

describe("AutoApprovals", () => {
  it("is off until switched on: everything is asked", async () => {
    const person = new Person();
    const auto = new AutoApprovals(person);

    expect(auto.enabled).toBe(false);
    expect(await auto.request({ call: call("DeleteProjectPath") })).toEqual({ approved: false, feedback: "no" });
    expect(person.asked).toEqual(["DeleteProjectPath"]);
  });

  it("when on, approves everything except what must always ask", async () => {
    const person = new Person();
    const auto = new AutoApprovals(person);
    auto.set(true);

    for (const name of ["UpdateFile", "SendWhatsappMessage", "MoveProjectPath", "RenamePath"]) {
      expect(await auto.request({ call: call(name) })).toEqual({ approved: true });
    }
    await auto.request({ call: call("GenerateImages", { alwaysAsk: true }) });
    await auto.request({ call: call("DeleteDir", { location: "desktop", alwaysAsk: true }) });
    await auto.request({ call: call("SomethingNew", { alwaysAsk: true }) });

    expect(person.asked).toEqual(["GenerateImages", "DeleteDir", "SomethingNew"]);
  });

  it("asks about images and deletions by name too, for a server that does not mark them", () => {
    for (const name of ["EditImage", "GenerateImages", "DeleteFile", "DeleteDir", "DeleteProjectPath"]) {
      expect(mustAsk(call(name))).toBe(true);
    }
    expect(mustAsk(call("WriteProjectFile"))).toBe(false);
    expect(mustAsk(call("SendWhatsappMessage"))).toBe(false);
  });

  it("tells listeners when it changes, and only then", () => {
    const auto = new AutoApprovals(new Person());
    const heard: boolean[] = [];
    auto.onChange((on) => heard.push(on));

    auto.set(true);
    auto.set(true);
    auto.set(false);

    expect(heard).toEqual([true, false]);
  });
});
