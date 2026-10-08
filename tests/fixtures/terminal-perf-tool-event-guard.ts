import http from "node:http";
import https from "node:https";
import { Socket } from "node:net";
import { InteractiveMode, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { createToolEventWorkload } from "../../scripts/terminal-perf/tool-event-workloads";

// This executable fixture must be launched in a fresh, isolated process by the test.
// Observe the same pinned private SDK seam as the workload instrumentation.
const toolPrototype = ToolExecutionComponent.prototype as unknown as { updateDisplay: unknown };
const originals = {
  fetch: globalThis.fetch,
  httpRequest: http.request,
  httpsGet: https.get,
  socketConnect: Socket.prototype.connect,
  updateDisplay: toolPrototype.updateDisplay,
  modeInit: InteractiveMode.prototype.init,
  offline: process.env.PI_OFFLINE,
};
const fixture = createToolEventWorkload({ historyTurns: 0, burstCount: 1, finalBytes: 512 });
const denied: boolean[] = [];
let attempts: number;
try {
  await fixture.setup();
  for (const call of [
    () => fetch("https://invalid.example/"),
    () => http.request("http://invalid.example/"),
    () => https.get("https://invalid.example/"),
    () => new Socket().connect(80, "invalid.example"),
  ]) {
    try {
      call();
      denied.push(false);
    } catch (error) {
      denied.push(String(error).includes("forbids network"));
    }
  }
  const evidence = await fixture.action();
  attempts = evidence.counts.networkAttempts;
} finally {
  await fixture.dispose();
}

const restored =
  globalThis.fetch === originals.fetch &&
  http.request === originals.httpRequest &&
  https.get === originals.httpsGet &&
  Socket.prototype.connect === originals.socketConnect &&
  toolPrototype.updateDisplay === originals.updateDisplay &&
  InteractiveMode.prototype.init === originals.modeInit &&
  process.env.PI_OFFLINE === originals.offline;
let freshProcessRequired = false;
try {
  await fixture.setup();
} catch (error) {
  freshProcessRequired = String(error).includes("fresh process");
}
console.log(JSON.stringify({ denied, restored, freshProcessRequired, attempts }));
