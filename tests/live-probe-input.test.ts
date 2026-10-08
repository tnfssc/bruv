import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeArgs, readStudy, studyTarget } from "../scripts/live/probe-input";

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

// Each input owns a retained file: rejection cases cannot inherit a previous case's bytes.
function studyFile(contents: string | Buffer) {
  const dir = mkdtempSync(join(tmpdir(), "live-probe-input-"));
  const file = join(dir, "input.jsonl");
  writeFileSync(file, contents);
  return file;
}

test("bounded JSONL preserves UTF-8 across chunks and stops at the study cutoff", () => {
  const entry = { timestamp: "2026-09-25T17:00:00.000Z", message: { role: "user", content: "a".repeat(4080) + "న" } };
  const file = studyFile(
    JSON.stringify(entry) + "\n" + JSON.stringify({ timestamp: "2026-09-25T18:00:00.000Z" }) + "\n",
  );
  const entries = readStudy(file);
  expect(studyTarget(entries, 0).message.content).toBe(entry.message.content);
  expect(entries).toHaveLength(1);
});

for (const { name, contents, error } of [
  { name: "malformed JSON", contents: "not json\n", error: undefined },
  { name: "a line exceeding 256 KiB", contents: "x".repeat(262145), error: /256 KiB/ },
  { name: "invalid UTF-8", contents: Buffer.from([0xff, 0x0a]), error: undefined },
]) {
  test("bounded JSONL rejects " + name, () => {
    const file = studyFile(contents);
    if (error) expect(() => readStudy(file)).toThrow(error);
    else expect(() => readStudy(file)).toThrow();
  });
}

for (const { script, args, message } of [
  { script: "live/probe-capability.ts", args: ["--disclose-root", "unknown:jobs"], message: "valid variant:scenario" },
  {
    script: "live/probe-recorded.ts",
    args: ["--source", "missing-private-study.jsonl", "--study-2026-09-25", "--disclose-private", "bad:fresh:baseline"],
    message: "Invalid trial",
  },
  {
    script: "live/probe-controlled.ts",
    args: [
      "--source",
      "missing-private-study.jsonl",
      "--study-2026-09-25",
      "--disclose-private",
      "bad:snapshot:baseline",
    ],
    message: "Invalid condition",
  },
]) {
  test(script + " rejects invalid plans before private source or credential/socket work", async () => {
    const home = mkdtempSync(join(tmpdir(), "live-probe-plan-"));
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_CACHE_HOME: join(home, "cache"),
      PI_CODING_AGENT_DIR: join(home, "sdk"),
      TMPDIR: join(home, "tmp"),
      BRUV_CAPABILITY_PROBE: "1",
      BRUV_RECORDED_PROBE: "1",
      BRUV_CONTROLLED_PROBE: "1",
    };
    for (const dir of [env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.PI_CODING_AGENT_DIR, env.TMPDIR]) mkdirSync(dir);
    // Resolve the deliberately missing source inside this owned fixture; retain it for inspection.
    const proc = Bun.spawn([process.execPath, new URL("../scripts/" + script, import.meta.url).pathname, ...args], {
      cwd: home,
      env,
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
  });
}
