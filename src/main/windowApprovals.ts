import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import type { PendingToolCall } from "../core/api";
import { CHANNELS, type ApprovalPrompt } from "../core/bridge";
import type { ApprovalDecision, ApprovalPort, ApprovalRequest } from "../core/tools/runner";

const NO_WINDOW: ApprovalDecision = {
  approved: false,
  feedback: "The desktop app's window was closed before the user could answer, so this was not done.",
  dismissed: true,
};

/**
 * Approvals asked in the app's window. Each question gets an id; the window answers
 * through the approvals:respond handler, which settles the matching promise.
 */
export class WindowApprovals implements ApprovalPort {
  private readonly waiting = new Map<string, { call: PendingToolCall; resolve: (decision: ApprovalDecision) => void }>();

  constructor(private readonly window: () => BrowserWindow | null) {}

  request({ call, preview, origin }: ApprovalRequest): Promise<ApprovalDecision> {
    const target = this.window();
    if (!target || target.isDestroyed()) return Promise.resolve(NO_WINDOW);

    const prompt: ApprovalPrompt = { id: randomUUID(), call, preview, origin };
    return new Promise((resolve) => {
      this.waiting.set(prompt.id, { call, resolve });
      target.webContents.send(CHANNELS.approvalsRequest, prompt);
      target.once("closed", () => this.respond(prompt.id, NO_WINDOW));
    });
  }

  /** Approves every open question that `which` picks -- auto mode switched on with some
   *  already on screen -- and tells the window to take them down. */
  approveWaiting(which: (call: PendingToolCall) => boolean): void {
    const settled = [...this.waiting].filter(([, { call }]) => which(call)).map(([id]) => id);
    if (!settled.length) return;
    for (const id of settled) this.respond(id, { approved: true });
    const target = this.window();
    if (target && !target.isDestroyed()) target.webContents.send(CHANNELS.approvalsSettled, settled);
  }

  /** Answers the open question about this call, if there is one, from somewhere other than
   *  the window -- the task strip -- and takes it down from the window. */
  answerCall(callId: string, decision: ApprovalDecision): boolean {
    const found = [...this.waiting].find(([, { call }]) => call.id === callId);
    if (!found) return false;
    this.respond(found[0], decision);
    const target = this.window();
    if (target && !target.isDestroyed()) target.webContents.send(CHANNELS.approvalsSettled, [found[0]]);
    return true;
  }

  respond(id: string, decision: ApprovalDecision): void {
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    waiting.resolve({
      approved: decision.approved === true,
      feedback: typeof decision.feedback === "string" ? decision.feedback.slice(0, 2000) : undefined,
      args: picks(decision.args),
      dismissed: decision.dismissed === true ? true : undefined,
    });
  }
}

/** The window's picks, as plain short strings only; the server checks them against the
 *  tool's own choices too. */
function picks(args: unknown): Record<string, string> | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const entries = Object.entries(args).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[0].length < 64 && entry[1].length < 128,
  );
  return entries.length ? Object.fromEntries(entries.slice(0, 8)) : undefined;
}
