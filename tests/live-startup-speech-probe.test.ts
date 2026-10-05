import { expect, test } from "bun:test";
import { startupSpeechCredentialPlan } from "../scripts/probe-live-startup-audio";

test("startup speech defaults to canonical Google and OpenAI keys", () => {
  expect(startupSpeechCredentialPlan([])).toEqual([
    { provider: "google", source: "canonical" },
    { provider: "openai", source: "canonical" },
  ]);
});

test("explicit live.env startup speech is Google-only", () => {
  expect(startupSpeechCredentialPlan(["--gemini-live-env"])).toEqual([{ provider: "google", source: "live.env" }]);
});
