import { expect, test } from "bun:test";
import { compactLiveStatus, liveLocalOnly } from "../src/live/status";

test("live is interactive local root CLI only", () => {
  expect(liveLocalOnly("tui", {}, true)).toBe(true);
  for (const mode of ["rpc", "print", "json"]) expect(liveLocalOnly(mode, {}, true)).toBe(false);
  for (const key of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY", "BRUV_WEB_BRUV_BINARY", "BRUV_SUBAGENT_DEPTH"])
    expect(liveLocalOnly("tui", { [key]: "1" }, true)).toBe(false);
  expect(liveLocalOnly("tui", {}, false)).toBe(false);
});

const idleRun: Parameters<typeof compactLiveStatus>[0] = {
  running: true,
  inputMode: "push-to-talk",
  talking: false,
  inputAvailable: true,
  speaking: false,
  thinking: false,
};

test("compact status waits for the run, even when input and output are active", () => {
  expect(compactLiveStatus({ ...idleRun, running: false, talking: true, speaking: true, thinking: true })).toBe(
    "Voice · connecting",
  );
});

test("continuous mic status reports playback, not push-to-talk controls or reasoning", () => {
  const run = { ...idleRun, inputMode: "continuous" as const, inputAvailable: false, thinking: true };
  expect(compactLiveStatus(run)).toBe("Voice · mic on");
  expect(compactLiveStatus({ ...run, speaking: true, talking: true })).toBe("Speaking · mic on");
});

test("held push-to-talk input takes priority over editor and output activity", () => {
  expect(compactLiveStatus({ ...idleRun, talking: true, inputAvailable: false, speaking: true, thinking: true })).toBe(
    "Listening · release Space to finish",
  );
});

test("unavailable push-to-talk input takes priority over playback and reasoning", () => {
  expect(compactLiveStatus({ ...idleRun, inputAvailable: false, speaking: true, thinking: true })).toBe(
    "Voice · input unavailable",
  );
});

test("available push-to-talk input reports playback before reasoning, then idle", () => {
  expect(compactLiveStatus({ ...idleRun, speaking: true, thinking: true })).toBe("Speaking · hold Space to reply");
  expect(compactLiveStatus({ ...idleRun, thinking: true })).toBe("Thinking · hold Space to speak");
  expect(compactLiveStatus(idleRun)).toBe("Voice · hold Space to speak");
});
