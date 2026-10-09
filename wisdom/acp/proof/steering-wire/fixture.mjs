#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
const root = new URL(".", import.meta.url).pathname;
let active;
const sanitize = (x) =>
  typeof x === "string"
    ? x
        .replace(/Bearer\s+[^\s"\\]+/g, "Bearer [REDACTED]")
        .replace(/(token|authorization|secret)(":")([^"]+)/gi, "$1$2[REDACTED]")
    : Array.isArray(x)
      ? x.map(sanitize)
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x).map(([k, v]) => [k, /token|authorization|secret/i.test(k) ? "[REDACTED]" : sanitize(v)]),
          )
        : x;
const record = (direction, message) =>
  fs.appendFileSync(
    `${root}wire.ndjson`,
    `${JSON.stringify({ time: new Date().toISOString(), pid: process.pid, direction, message: sanitize(message) })}\n`,
  );
const send = (m) => {
  record("agent-to-client", m);
  process.stdout.write(`${JSON.stringify(m)}\n`);
};
const result = (id, result) => send({ jsonrpc: "2.0", id, result });
const update = (sessionId, update) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
const text = (s, t) => update(s, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  record("client-to-agent", m);
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize":
      result(m.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        agentInfo: { name: "Steering Wire Research Fixture (not Bruv/Pi)", version: "0.1.0" },
        authMethods: [],
      });
      break;
    case "session/new":
      result(m.id, {
        sessionId: randomUUID(),
        models: { currentModelId: "fixture", availableModels: [{ modelId: "fixture", name: "Research fixture" }] },
      });
      break;
    case "session/set_model":
    case "session/set_mode":
      result(m.id, {});
      break;
    case "session/prompt": {
      const t = p.prompt
        .filter((x) => x.type === "text")
        .map((x) => x.text)
        .join("\n");
      const marker = t.match(/WIRE_[A-Z_0-9]+/g)?.join(",") ?? "setup";
      text(p.sessionId, `RESEARCH ONLY ${marker}\n`);
      if (t.includes("WIRE_LONG")) {
        const toolCallId = `wire-tool-${m.id}`;
        update(p.sessionId, {
          sessionUpdate: "tool_call",
          toolCallId,
          title: "Research simulated long work (no actual tool/credentials)",
          kind: "other",
          status: "in_progress",
          rawInput: { research: true },
        });
        active = { id: m.id, sessionId: p.sessionId, toolCallId };
      } else {
        result(m.id, { stopReason: "end_turn" });
      }
      break;
    }
    case "session/cancel":
      if (active) {
        update(active.sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId: active.toolCallId,
          status: "failed",
          rawOutput: "Research fixture obeyed cancel",
        });
        result(active.id, { stopReason: "cancelled" });
        active = undefined;
      }
      break;
    default:
      if (m.id !== undefined)
        send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Unsupported research method" } });
  }
});
process.stdin.on("end", () => process.exit(0));
record("lifecycle", { event: "started" });
