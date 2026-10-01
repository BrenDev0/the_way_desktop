import { describe, expect, it } from "vitest";
import type { PendingToolCall } from "../../src/core/api";
import { PresetAnswers } from "../../src/core/tools/presetAnswers";
import type { ApprovalDecision, ApprovalRequest } from "../../src/core/tools/runner";

const call = (id: string): PendingToolCall => ({ id, name: "GenerateImages", args: {}, location: "server", requiresApproval: true, detail: null });

class Person {
  asked: string[] = [];
  async request({ call }: ApprovalRequest): Promise<ApprovalDecision> {
    this.asked.push(call.id);
    return { approved: false };
  }
}

describe("PresetAnswers", () => {
  it("answers a question from the strip's answer, once, and asks about anything else", async () => {
    const person = new Person();
    const answers = new PresetAnswers(person);
    answers.preset("c1", { approved: true, args: { model: "gpt-image-2.5-sunburst" } });

    expect(await answers.request({ call: call("c1") })).toEqual({ approved: true, args: { model: "gpt-image-2.5-sunburst" } });
    expect(person.asked).toEqual([]);

    await answers.request({ call: call("c1") }); // used up: asked again
    await answers.request({ call: call("c2") });
    expect(person.asked).toEqual(["c1", "c2"]);
  });
});
