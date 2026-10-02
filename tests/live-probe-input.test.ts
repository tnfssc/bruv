import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeArgs, readStudy, studyTarget } from "../scripts/live-probe-input";

const flags = ["--source", "fixture.jsonl", "--study-2026-09-25", "--disclose-private", "audio:fresh:baseline"];
test("source, historical study and disclosure are explicit", () => {
  expect(() => probeArgs([], "recorded")).toThrow();
  expect(() =>
    probeArgs(
      flags.filter((x) => x !== "--disclose-private"),
      "recorded",
    ),
  ).toThrow();
  expect(() => probeArgs(["--synthetic", "audio:fresh:baseline"], "controlled")).toThrow();
  expect(() => probeArgs(["--synthetic", "--disclose-private", "en:fresh:baseline"], "recorded")).toThrow();
  expect(probeArgs(flags, "recorded").source).toBe("fixture.jsonl");
  expect(probeArgs(["--synthetic", "--disclose-private", "en:fresh:baseline"], "controlled").synthetic).toBe(true);
});

test("bounded JSONL preserves UTF-8 across chunks; cutoff and malformed input", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-probe-"));
  const file = join(dir, "input.jsonl");
  try {
    const entry = { timestamp: "2026-09-25T17:00:00.000Z", message: { role: "user", content: "a".repeat(4080) + "న" } };
    writeFileSync(
      file,
      JSON.stringify(entry) + "\n" + JSON.stringify({ timestamp: "2026-09-25T18:00:00.000Z" }) + "\n",
    );
    expect(studyTarget(readStudy(file), 0).message.content).toBe(entry.message.content);
    expect(readStudy(file)).toHaveLength(1);
    writeFileSync(file, "not json\n");
    expect(() => readStudy(file)).toThrow();
    writeFileSync(file, "x".repeat(262145));
    expect(() => readStudy(file)).toThrow(/256 KiB/);
    writeFileSync(file, Buffer.from([0xff, 0x0a]));
    expect(() => readStudy(file)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid study plans fail before private source or credential/socket work", async () => {
  for (const [script, args, message] of [
    ["probe-live-capability.ts", ["--disclose-root", "unknown:jobs"], "valid variant:scenario"],
    [
      "probe-live-recorded.ts",
      ["--source", "/nonexistent-private-study", "--study-2026-09-25", "--disclose-private", "bad:fresh:baseline"],
      "Invalid trial",
    ],
    [
      "probe-live-controlled.ts",
      ["--source", "/nonexistent-private-study", "--study-2026-09-25", "--disclose-private", "bad:snapshot:baseline"],
      "Invalid condition",
    ],
  ] as const) {
    const proc = Bun.spawn([process.execPath, new URL("../scripts/" + script, import.meta.url).pathname, ...args], {
      env: {
        PATH: process.env.PATH,
        HOME: "/nonexistent-study-home",
        BRUV_CAPABILITY_PROBE: "1",
        BRUV_RECORDED_PROBE: "1",
        BRUV_CONTROLLED_PROBE: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(code).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain(message);
    expect(stderr).not.toContain("ENOENT");
    expect(stderr).not.toContain("credential");
  }
});
