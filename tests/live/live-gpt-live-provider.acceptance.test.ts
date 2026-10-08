import { expect, test } from "bun:test";
import { GPTLiveSession } from "../../src/live/gpt-live-session";

// Explicit paid transport-only acceptance. No auth-store lookup, devices or automatic retry.
const enabled = process.env.BRUV_RUN_GPT_LIVE_ACCEPTANCE === "1";
(enabled ? test : test.skip)(
  "paid GPT-Live start, paced silence PCM, finalized close",
  async () => {
    const key = process.env.BRUV_GPT_LIVE_ACCEPTANCE_API_KEY;
    if (!key) throw new Error("Explicit BRUV_GPT_LIVE_ACCEPTANCE_API_KEY required");
    const errors: string[] = [];
    let finalized = false;
    const voice = new GPTLiveSession({
      onError: (e) => errors.push(e),
      onClosed: (done) => {
        finalized = done;
      },
    });
    try {
      await voice.connect(key);
      expect(voice.state).toBe("ready");
      for (let i = 0; i < 10; i++) {
        voice.appendMicrophone(Buffer.alloc(640));
        await Bun.sleep(20);
      }
      await voice.close();
      expect(errors).toEqual([]);
      expect(finalized).toBe(true);
    } finally {
      await voice.close();
    }
  },
  35_000,
);
