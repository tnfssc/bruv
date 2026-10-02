import { expect, test } from "bun:test";
import { createDefaultLiveCredentialService } from "../src/live/credentials";
import { OpenAIRealtimeSession } from "../src/live/openai-session";
import { setupProbeOrchestration } from "../src/live/setup-probe";

// PAID, KEY-ACCESS OPT-IN: run only after explicit user consent. No devices,
// generated response, or real agent dispatch. Passing proves session setup only.
test.skipIf(process.env.BRUV_RUN_OPENAI_LIVE_ACCEPTANCE !== "1")(
  "real OpenAI accepts the GA Live configuration and configured-agent tool schema",
  async () => {
    const controller = new AbortController();
    const credentials = await createDefaultLiveCredentialService(controller.signal, "openai");
    const key = await credentials.loadKey(controller.signal);
    const errors: string[] = [];
    const voice = new OpenAIRealtimeSession(
      { onError: (error) => errors.push(error.code) },
      undefined,
      setupProbeOrchestration(),
    );
    try {
      await voice.connect(key);
      expect(errors).toEqual([]);
      expect(voice.state).toBe("ready");
    } finally {
      controller.abort();
      voice.close();
    }
    expect(voice.state).toBe("closed");
  },
  25_000,
);
