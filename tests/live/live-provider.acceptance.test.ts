import { expect, test } from "bun:test";
import { createDefaultLiveCredentialService } from "../../src/live/credentials";
import { VoiceSession } from "../../src/live/session";
import { setupProbeOrchestration } from "../../src/live/setup-probe";

// Explicit paid opt-in. Uses canonical provider auth; never imports a file or opens devices.
test.skipIf(process.env.BRUV_RUN_GEMINI_LIVE_ACCEPTANCE !== "1")(
  "real Gemini accepts the native Live SDK session configuration",
  async () => {
    const controller = new AbortController();
    const credentials = await createDefaultLiveCredentialService(controller.signal);
    const key = await credentials.loadKey(controller.signal);
    const errors: string[] = [];
    const voice = new VoiceSession(
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
