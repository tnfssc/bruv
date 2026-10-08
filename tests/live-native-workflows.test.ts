import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

type Step = { name?: string; run?: string; if?: string };
type Job = { steps: Step[] };
async function load(name: string) {
  return Bun.YAML.parse(await Bun.file(new URL("../.github/workflows/" + name + ".yml", import.meta.url)).text()) as {
    jobs: Record<string, Job>;
  };
}
const lanes = [
  ["ci", "native-linux"],
  ["ci", "live-macos"],
  ["release", "release"],
  ["release", "mac-helper"],
  ["live", "macos-helper"],
] as const;

// Replay only the device-free hello script, never the workflow's build or shell steps.
function expectHelloSmokeAcceptsOnlyExactHandshake(smoke: string) {
  const python = smoke.split("python3 - <<'PY'\n")[1]!.split("\nPY")[0]!;
  // Retain this owned fixture for inspection; no inherited HOME/config/SDK is used.
  const root = mkdtempSync(join(tmpdir(), "live-workflow-hello-"));
  const env = {
    PATH: process.env.PATH,
    HOME: mkdtempSync(join(root, "home-")),
    XDG_CONFIG_HOME: mkdtempSync(join(root, "config-")),
    PI_CODING_AGENT_DIR: mkdtempSync(join(root, "sdk-")),
    TMPDIR: mkdtempSync(join(root, "tmp-")),
  };
  mkdirSync(join(root, "dist"));
  for (const [hello, succeeds] of [
    [{ type: "hello", protocol: 1, captureGate: true }, true],
    [{ type: "hello", protocol: 1 }, false],
    [{ type: "hello", protocol: 1, captureGate: false }, false],
    [{ type: "hello", protocol: 2, captureGate: true }, false],
    [{ type: "hello", protocol: 1, captureGate: true, extra: true }, false],
  ] as const) {
    writeFileSync(
      join(root, "dist/live-audio"),
      "#!/usr/bin/env python3\nimport sys\nprint(" +
        JSON.stringify(JSON.stringify(hello)) +
        ", flush=True)\nsys.stdin.read()\n",
      { mode: 0o755 },
    );
    const result = spawnSync("python3", ["-c", python], { cwd: root, env, encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status === 0).toBe(succeeds);
  }
}

for (const [workflow, lane] of lanes) {
  test(workflow + "/" + lane + " requires sanitized portable capture-origin tests", async () => {
    const steps = (await load(workflow)).jobs[lane]!.steps;
    for (const source of ["native/live/test-capture-gate.c", "native/live-linux/tests/capture-gate.cpp"]) {
      const step = steps.find((step) => step.run?.includes(source))!;
      expect(step).toBeDefined();
      expect(step.if).toBeUndefined();
      const line = step.run!.split("\n").find((line) => line.includes(source))!;
      expect(line).toContain("-Wall -Wextra -Werror -fsanitize=address,undefined");
      const binary = line.split(" -o ")[1]!;
      expect(step.run!.split("\n")).toContain(binary);
    }
  });
}

for (const [workflow, lane] of lanes.filter(([, lane]) => lane !== "native-linux" && lane !== "release")) {
  test(workflow + "/" + lane + " compiles Swift and checks exact hello without devices", async () => {
    const steps = (await load(workflow)).jobs[lane]!.steps;
    const commands = steps.map((step) => step.run ?? "").join("\n");
    const smoke = steps.find((step) => step.run?.includes("helper hello timed out"))!.run!;
    const compile = commands.indexOf("scripts/live/build-helper.sh");
    expect(compile).toBeGreaterThanOrEqual(0);
    expect(compile).toBeLessThan(commands.indexOf("python3 - <<'PY'"));
    expect(smoke).not.toContain('"type":"start"');
    expect(smoke).toContain("== {'type': 'hello', 'protocol': 1, 'captureGate': True}");
    expectHelloSmokeAcceptsOnlyExactHandshake(smoke);
  });
}

test("Linux protocol gate builds the real 1.x helper and uses only a private Pulse null graph", async () => {
  const steps = (await load("ci")).jobs["native-linux"]!.steps;
  const fixture = steps.find((step) => step.name?.startsWith("Capture-origin protocol"))!;
  expect(fixture.if).toBeUndefined();
  const run = fixture.run!;
  expect(run).toContain(
    "https://deb.debian.org/debian/pool/main/w/webrtc-audio-processing/webrtc-audio-processing_1.3.orig.tar.gz",
  );
  expect(run.indexOf("sha256sum --check")).toBeLessThan(run.indexOf("tar -xzf"));
  expect(run).toContain("95552fc17faa0202133707bbb3727e8c2cf64d4266fe31bfdb2298d769c1db75");
  expect(run).toContain("sha256sum --check");
  expect(run).toContain("--wrap-mode=nofallback");
  expect(run).toContain('meson compile -C "$fixture/build" -j 2');
  expect(run).toContain('export CPLUS_INCLUDE_PATH="$fixture/apm/include"');
  expect(run).toContain('bash scripts/live/build-linux-helper.sh "$fixture/live-audio-linux"');
  expect(run).toContain('PULSE_SERVER="unix:$fixture/native"');
  expect(run).toContain('pulseaudio -nF "$fixture/pulse.pa"');
  const config = run.split('cat > "$fixture/pulse.pa" <<EOF\n')[1]!.split("\nEOF")[0]!;
  expect(config.split("\n").filter((line) => line.startsWith("load-module "))).toHaveLength(3);
  expect(config).toContain("module-native-protocol-unix");
  expect(config).toContain("sink_name=bruv_ci_mic");
  expect(config).toContain("sink_name=bruv_ci_out");
  expect(config).not.toMatch(/udev|alsa|bluetooth|default.pa/);
  expect(run).toContain(
    'python3 native/live-linux/tests/capture-protocol.py "$fixture/live-audio-linux" bruv_ci_mic.monitor bruv_ci_out',
  );
  expect(run).toContain("trap cleanup EXIT");
  expect(run).toContain('kill "$pulse_pid"');
  expect(run).toContain('wait "$pulse_pid"');
});
