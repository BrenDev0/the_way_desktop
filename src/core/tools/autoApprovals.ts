import type { PendingToolCall } from "../api";
import type { ApprovalDecision, ApprovalPort, ApprovalRequest } from "./runner";

/**
 * Tools that are always put to the user, by name -- for a server too old to mark them.
 * The server's own flag (alwaysAsk) is what normally decides. Images spend the user's
 * money; a deletion cannot be undone.
 */
const ALWAYS_ASK = new Set(["GenerateImages", "EditImage", "DeleteFile", "DeleteDir", "DeleteProjectPath"]);

export function mustAsk(call: PendingToolCall): boolean {
  return call.alwaysAsk === true || ALWAYS_ASK.has(call.name);
}

/**
 * Auto mode: every approval answered "yes" without asking, except the calls that must
 * always ask -- images and deletions. Off unless switched on, and off again each time the
 * app starts, so it is never left on by accident.
 */
export class AutoApprovals implements ApprovalPort {
  private on = false;
  private readonly listeners = new Set<(on: boolean) => void>();

  constructor(private readonly ask: ApprovalPort) {}

  get enabled(): boolean {
    return this.on;
  }

  set(on: boolean): boolean {
    if (this.on !== on) {
      this.on = on;
      for (const listener of this.listeners) listener(on);
    }
    return this.on;
  }

  onChange(listener: (on: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (this.on && !mustAsk(request.call)) return Promise.resolve({ approved: true });
    return this.ask.request(request);
  }
}
