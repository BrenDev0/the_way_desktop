import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { CHANNELS, type ApprovalPrompt } from "../core/bridge";
import type { ApprovalDecision, ApprovalPort, ApprovalRequest } from "../core/tools/runner";

const NO_WINDOW: ApprovalDecision = {
  approved: false,
  feedback: "The desktop app's window was closed before the user could answer, so this was not done.",
};

/**
 * Approvals asked in the app's window. Each question gets an id; the window answers
 * through the approvals:respond handler, which settles the matching promise.
 */
export class WindowApprovals implements ApprovalPort {
  private readonly waiting = new Map<string, (decision: ApprovalDecision) => void>();

  constructor(private readonly window: () => BrowserWindow | null) {}

  request({ call, preview }: ApprovalRequest): Promise<ApprovalDecision> {
    const target = this.window();
    if (!target || target.isDestroyed()) return Promise.resolve(NO_WINDOW);

    const prompt: ApprovalPrompt = { id: randomUUID(), call, preview };
    return new Promise((resolve) => {
      this.waiting.set(prompt.id, resolve);
      target.webContents.send(CHANNELS.approvalsRequest, prompt);
      target.once("closed", () => this.respond(prompt.id, NO_WINDOW));
    });
  }

  respond(id: string, decision: ApprovalDecision): void {
    const resolve = this.waiting.get(id);
    if (!resolve) return;
    this.waiting.delete(id);
    resolve({
      approved: decision.approved === true,
      feedback: typeof decision.feedback === "string" ? decision.feedback.slice(0, 2000) : undefined,
    });
  }
}
