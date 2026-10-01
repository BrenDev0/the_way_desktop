import { describe, expect, it } from "vitest";
import type { PendingToolCall } from "../../src/core/api";
import { ImageAllowance, imagesIn } from "../../src/core/tools/imageAllowance";
import type { ApprovalDecision, ApprovalRequest } from "../../src/core/tools/runner";

const SUNBURST = "gpt-image-2.5-sunburst";

function generate(count: number): PendingToolCall {
  return {
    id: `g${count}`, name: "GenerateImages", location: "server", requiresApproval: true, detail: null,
    args: { images: Array.from({ length: count }, () => ({})), model: "gpt-image-2.5-flare" }, alwaysAsk: true,
  };
}

function edit(): PendingToolCall {
  return { id: "e", name: "EditImage", location: "server", requiresApproval: true, detail: null, args: { output_paths: ["a.png"] }, alwaysAsk: true };
}

class Person {
  asked = 0;
  constructor(private readonly answer: ApprovalDecision) {}
  async request(_: ApprovalRequest): Promise<ApprovalDecision> {
    this.asked += 1;
    return this.answer;
  }
}

describe("ImageAllowance", () => {
  it("asks once per reply, then lets up to 10 images through with the model picked", async () => {
    const person = new Person({ approved: true, args: { model: SUNBURST } });
    const allowance = new ImageAllowance(person);

    await allowance.request({ call: generate(3), run: "conv:1" }); // asked: 3 of 10
    for (let round = 0; round < 7; round += 1) {
      expect(await allowance.request({ call: edit(), run: "conv:1" })).toEqual({ approved: true, args: { model: SUNBURST } });
    }
    expect(person.asked).toBe(1);

    await allowance.request({ call: edit(), run: "conv:1" }); // the 11th asks again
    expect(person.asked).toBe(2);
  });

  it("starts over on the next reply, and a refusal grants nothing", async () => {
    const yes = new Person({ approved: true });
    const allowance = new ImageAllowance(yes);
    await allowance.request({ call: generate(1), run: "conv:1" });
    await allowance.request({ call: generate(1), run: "conv:2" });
    expect(yes.asked).toBe(2);

    const no = new Person({ approved: false });
    const refused = new ImageAllowance(no);
    await refused.request({ call: edit(), run: "conv:3" });
    await refused.request({ call: edit(), run: "conv:3" });
    expect(no.asked).toBe(2);
  });

  it("counts what a call makes, and leaves other calls alone", async () => {
    expect(imagesIn(generate(4))).toBe(4);
    expect(imagesIn(edit())).toBe(1);
    const person = new Person({ approved: true });
    const allowance = new ImageAllowance(person);
    const other: PendingToolCall = { id: "d", name: "DeleteFile", location: "desktop", requiresApproval: true, detail: null, args: {} };
    await allowance.request({ call: other, run: "conv:1" });
    await allowance.request({ call: other, run: "conv:1" });
    expect(person.asked).toBe(2);
  });
});
