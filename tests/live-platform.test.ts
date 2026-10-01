import { describe, expect, test } from "bun:test";
import { audioEnvironment, defaultHelperPath } from "../src/live/audio";
describe("native live platform paths", () => {
  test("source and compiled helper paths are not based on the user's project", () => {
    expect(defaultHelperPath("linux", "file:///opt/bruv/src/live/audio.ts", "/usr/bin/bun")).toBe(
      "/opt/bruv/dist/live-audio-linux",
    );
    expect(defaultHelperPath("darwin", "file:///$bunfs/root/bruv", "/opt/bruv/bin/bruv")).toBe(
      "/opt/bruv/bin/live-audio",
    );
    expect(defaultHelperPath("linux", "file:///$bunfs/root/bruv", "/opt/bruv/bin/bruv")).toBe(
      "/opt/bruv/bin/live-audio-linux",
    );
  });
  test("preserves audio daemon discovery but strips model credentials", () => {
    const env = audioEnvironment({
      HOME: "/home/test",
      XDG_RUNTIME_DIR: "/run/user/test",
      PULSE_SERVER: "unix:/test",
      LIVE_SOURCE: "isolated.monitor",
      GEMINI_API_KEY: "private",
      OPENAI_API_KEY: "private",
    });
    expect(env.HOME).toBe("/home/test");
    expect(env.PULSE_SERVER).toBe("unix:/test");
    expect(env.LIVE_SOURCE).toBe("isolated.monitor");
    expect(env).not.toHaveProperty("GEMINI_API_KEY");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });
});
