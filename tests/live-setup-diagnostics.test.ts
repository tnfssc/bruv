import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { audioDiagnostic } from "../src/live/diagnostics";

test("startup graph ordering and catch-stage coverage", () => {
  const swift = readFileSync(new URL("../native/live/main.swift", import.meta.url), "utf8");
  const ordered = [
    "setVoiceProcessingEnabled(true)",
    "outputNode.inputFormat(forBus: 0)",
    "connect(audio.mainMixerNode, to: audio.outputNode",
    "audio.attach(source)",
    "audio.connect(source, to: audio.mainMixerNode",
    "audio.inputNode.installTap",
    "try audio.start()",
  ];
  let previous = -1;
  for (const item of ordered) {
    const index = swift.indexOf(item);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
  for (const stage of [
    "voice_processing",
    "input_format",
    "output_format",
    "output_connect",
    "source_attach",
    "source_connect",
    "tap_install",
    "engine_start",
  ]) {
    expect(swift).toContain(`phase = "${stage}"`);
    expect(audioDiagnostic(stage)).toContain("[" + stage + "]");
  }
  expect(audioDiagnostic("engine_start", { domain: "NSOSStatusErrorDomain", number: -10875 })).toContain(
    "NSOSStatusErrorDomain -10875",
  );
  expect(audioDiagnostic("engine_start", { domain: "private/device", number: 1 })).not.toContain("private");
  expect(audioDiagnostic("engine_start", { domain: "SECRET_TOKEN_123", number: 1 })).not.toContain("SECRET_TOKEN_123");
});

// Source-level check only: AVFoundation startup and the helper self-test run on macOS.
test("output polling preserves ready and shutdown acknowledgement barriers", () => {
  const swift = readFileSync(new URL("../native/live/main.swift", import.meta.url), "utf8");
  const polling = swift
    .split("func startPolling(captureRate: Double, ready: [String: Any]) {")[1]!
    .split("func cancelPolling()")[0]!;
  expect(polling).toContain("queue.sync");
  expect(polling).toContain("self.running = true");
  expect(polling).toContain("event(ready)");
  expect(polling).toContain("timer.resume()");
  expect(polling.indexOf("event(ready)")).toBeLessThan(polling.indexOf("timer.resume()"));

  const stop = swift.split("func stop() {")[1]!.split("func command(")[0]!;
  const teardown = ["output.cancelPolling()", "engine?.stop()", "ll_flush(core", "output.finishStop()"];
  let previous = -1;
  for (const operation of teardown) {
    const index = stop.indexOf(operation);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
  const finish = swift.split("func finishStop() {")[1]!.split("func captureGate(")[0]!;
  expect(finish).toContain("queue.sync");
  expect(finish).toContain("self.running = false");
  expect(finish).toContain("self.discardCapture()");
  expect(finish).toContain('self.writeEvent(["type":"played", "queuedMs":0])');
  expect(finish).toContain('self.writeEvent(["type":"stopped"])');
  expect(finish.indexOf('"type":"played"')).toBeLessThan(finish.indexOf('"type":"stopped"'));
});
