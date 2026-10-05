import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function nativeTest(compiler: string, sources: string[], flags: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "live-capture-gate-"));
  try {
    const bin = join(dir, "test");
    const build = Bun.spawn([compiler, ...flags, ...sources, "-o", bin], { stdout: "pipe", stderr: "pipe" });
    const stderr = await new Response(build.stderr).text();
    expect({ exit: await build.exited, stderr }).toEqual({ exit: 0, stderr: "" });
    const run = Bun.spawn([bin], { stdout: "pipe", stderr: "pipe" });
    expect(await run.exited).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("Linux gate rejects server/device backlog and re-arms every hold", async () => {
  await nativeTest("c++", ["native/live-linux/tests/capture-gate.cpp"], ["-std=c++17", "-Wall", "-Wextra", "-Werror"]);
});
test("native capture ring tags acquisition epochs and discards muted callbacks", async () => {
  await nativeTest(
    "cc",
    ["native/live/AudioCore.c", "native/live/test-capture-gate.c"],
    ["-std=c11", "-Wall", "-Wextra", "-Werror"],
  );
});
test("macOS uses tap origin host time, discards old tags and resets converter before opening", async () => {
  const swift = await readFile("native/live/main.swift", "utf8");
  expect(swift).toContain("time.isHostTimeValid ? time.hostTime : 0");
  expect(swift).toContain("ll_capture_push_epoch(core, channel + offset, Int32(n), epoch)");
  expect(swift).toContain("guard epoch == ll_capture_current_epoch(core), epoch != -1 else { continue }");
  expect(swift).toContain('message["epoch"] = Int(epoch)');
  const command = swift.split('case "capture_gate":')[1]!.split('case "start":')[0]!;
  expect(command).toContain("let cutoff = mach_absolute_time()");
  expect(command).toContain("output.sync");
  expect(command).toContain("self.resampler.reset()");
  expect(command).not.toContain("engine?.stop()");
});

test("Linux clears local backlog, half-packets and WebRTC state on gate transitions", async () => {
  const cpp = await readFile("native/live-linux/main.cpp", "utf8");
  const apply = cpp.split("void applyCaptureGate() {")[1]!.split("void armCaptureGate() {")[0]!;
  expect(apply).toContain("capture.clear(); captureHead = 0; packetHalf = 0; packet.fill(0)");
  expect(apply).toContain("apm->Initialize()");
  expect(apply).not.toContain("stop()");
  expect(cpp).toContain("pa_stream_update_timing_info(input, gateTimed, this)");
  expect(cpp).toContain("self.captureGate.arm(timing->write_index, timing->source_usec)");
  expect(cpp).toContain("self.captureGate.accepts(timing ? timing->read_index : 0");
});
