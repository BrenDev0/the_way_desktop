import type { ApprovalDecision, ApprovalPort, ApprovalRequest } from "./runner";

/**
 * Answers given before the question is asked -- a task approved from the strip on the
 * screen edge, for every call it waits on at once. When the question about one of those
 * calls comes, it is answered from here, once, and nobody is asked.
 */
export class PresetAnswers implements ApprovalPort {
  private readonly answers = new Map<string, ApprovalDecision>();

  constructor(private readonly ask: ApprovalPort) {}

  preset(callId: string, decision: ApprovalDecision): void {
    this.answers.set(callId, decision);
  }

  request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const answer = this.answers.get(request.call.id);
    if (!answer) return this.ask.request(request);
    this.answers.delete(request.call.id);
    return Promise.resolve(answer);
  }
}
