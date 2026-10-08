import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { getInstructionContinuitySession } from "../../src/agent/instruction-continuity";

/** Keep real owner/session prompting, replacing only the model response. */
export function installOfflineModelReply(sessionManager: object, text: string): void {
  const session = getInstructionContinuitySession(sessionManager) as any;
  session.agent.streamFunction = (model: any) => {
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: "stop",
      message: {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        stopReason: "stop",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        content: [{ type: "text", text }],
      },
    });
    return stream;
  };
}
