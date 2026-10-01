import type { PendingToolCall, ToolResolution } from "../api";
import { REQUIRES_APPROVAL, type ToolRegistry } from "./contract";

export interface ApprovalRequest {
  call: PendingToolCall;
  /** Extra detail to show: the diff an edit would make, the message being sent. */
  preview?: string;
  /** Who is asking, when it is not the chat in front of the user: a background task. */
  origin?: string;
  /** The run the call belongs to -- one chat reply. One image approval covers the run. */
  run?: string;
}

export interface ApprovalDecision {
  approved: boolean;
  /** Why not, or what to do instead -- the model is told to follow it. */
  feedback?: string;
  /** What the approver picked among the call's choices (the image model, say). */
  args?: Record<string, string>;
  /** Nobody answered -- the window closed. Not a refusal: a task can ask again later. */
  dismissed?: boolean;
}

/** Asks the person at the keyboard. The main process forwards this to the window. */
export interface ApprovalPort {
  request(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export const UNKNOWN_TOOL =
  "This version of the desktop app does not know the tool '{name}', so it was not run. " +
  "Tell the user their desktop app may need updating, and carry on without it.";

/**
 * Turns every call a conversation is paused on into exactly one resolution.
 *
 * Desktop calls are run here, after the user approves the ones that need it. Server calls
 * are never run here: they reach the client only to be approved, and the server runs them.
 * Calls are handled one at a time, so approvals come up in the order the model asked for
 * them and an answer can never land on the wrong question.
 */
export class ToolRunner {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly approvals: ApprovalPort,
  ) {}

  implements(name: string): boolean {
    return name in this.tools;
  }

  /** Server tool names this build has no handler for. */
  missingFrom(serverTools: readonly string[]): string[] {
    return serverTools.filter((name) => !this.implements(name));
  }

  async resolveAll(calls: readonly PendingToolCall[], run?: string): Promise<ToolResolution[]> {
    const resolutions: ToolResolution[] = [];
    for (const call of calls) resolutions.push(await this.resolve(call, run));
    return resolutions;
  }

  async resolve(call: PendingToolCall, run?: string): Promise<ToolResolution> {
    const handler = this.tools[call.name];

    if (call.location === "server") {
      const decision = await this.approvals.request({ call, preview: call.preview ?? undefined, run });
      return this.decided(call, decision);
    }

    if (!handler) {
      return {
        toolCallId: call.id,
        approved: true,
        output: UNKNOWN_TOOL.replace("{name}", call.name),
        failed: true,
      };
    }

    if (call.requiresApproval || REQUIRES_APPROVAL.has(call.name)) {
      const preview = await handler.preview?.(call.args).catch(() => undefined);
      const decision = await this.approvals.request({ call, preview, run });
      if (!decision.approved) return this.decided(call, decision);
    }

    try {
      return { toolCallId: call.id, approved: true, output: await handler.run(call.args) };
    } catch (error) {
      return { toolCallId: call.id, approved: true, output: describe(error), failed: true };
    }
  }

  private decided(call: PendingToolCall, decision: ApprovalDecision): ToolResolution {
    return decidedResolution(call, decision);
  }
}

/** A decision as the server takes it: picks only for the choices the call offers. */
export function decidedResolution(call: PendingToolCall, decision: ApprovalDecision): ToolResolution {
  const resolution: ToolResolution = { toolCallId: call.id, approved: decision.approved };
  if (decision.feedback?.trim()) resolution.feedback = decision.feedback.trim();
  const picks = Object.entries(decision.args ?? {}).filter(([name, value]) => call.choices?.[name]?.includes(value));
  if (decision.approved && picks.length) resolution.args = Object.fromEntries(picks);
  return resolution;
}

export function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
