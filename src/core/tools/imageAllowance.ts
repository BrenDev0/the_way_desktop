import type { PendingToolCall } from "../api";
import type { ApprovalDecision, ApprovalPort, ApprovalRequest } from "./runner";

/** What one image approval covers in a run: this many images, generated and edited
 *  together, with the model picked. The server's background tasks keep the same rule. */
export const IMAGES_PER_APPROVAL = 10;

/** How many images a call makes; 0 for anything that is not an image call. */
export function imagesIn(call: PendingToolCall): number {
  if (call.name === "GenerateImages") return Math.max(1, Array.isArray(call.args.images) ? call.args.images.length : 1);
  if (call.name === "EditImage") return Math.max(1, Array.isArray(call.args.output_paths) ? call.args.output_paths.length : 1);
  return 0;
}

interface Grant {
  remaining: number;
  args: Record<string, string>;
}

/**
 * One approval per run for images. The first image call of a chat reply is put to the
 * user, who picks the model; if they approve, the rest of that reply's images -- up to
 * IMAGES_PER_APPROVAL in all, edits included -- go through on that answer, with that
 * model. Past it, or in the next reply, the user is asked again.
 */
export class ImageAllowance implements ApprovalPort {
  private readonly grants = new Map<string, Grant>();

  constructor(private readonly ask: ApprovalPort) {}

  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const cost = imagesIn(request.call);
    if (!cost || !request.run) return this.ask.request(request);

    const grant = this.grants.get(request.run);
    if (grant && cost <= grant.remaining) {
      grant.remaining -= cost;
      return { approved: true, args: { ...grant.args } };
    }

    const decision = await this.ask.request(request);
    if (decision.approved) {
      const model = decision.args?.model ?? (typeof request.call.args.model === "string" ? request.call.args.model : undefined);
      this.grants.set(request.run, { remaining: Math.max(0, IMAGES_PER_APPROVAL - cost), args: model ? { model } : {} });
    } else {
      this.grants.delete(request.run);
    }
    return decision;
  }
}
