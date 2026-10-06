/** Synchronous post-await footer callbacks; no timing gate. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "../../../src/history/session-manager";
import { SessionCostTracker } from "../../../src/tasks/session-costs";
import { createTaskLifecycleRecorder, taskLifecycleFile } from "../../../src/tasks/task-lifecycle";
const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const root = mkdtempSync(join(tmpdir(), "bruv-disk-callback-audit-"));
const samples: any[] = [],
  managers: SessionManager[] = [];
try {
  installDiskBackedSessionManager();
  for (const payloadBytes of [4096, 2097152, 8388608]) {
    const dir = join(root, String(payloadBytes));
    const parent = SessionManager.create(root, dir);
    managers.push(parent);
    parent.appendMessage({ role: "user", content: "audit parent", timestamp: 1 });
    const child = SessionManager.create(root, dir, { parentSession: parent.getSessionFile()! });
    managers.push(child);
    child.appendCustomEntry("bruv-agent", { parentSessionFile: parent.getSessionFile() });
    child.appendMessage({ role: "user", content: "audit child", timestamp: 1 });
    const text = "0123456789abcdef".repeat(payloadBytes / 16);
    child.appendMessage({
      role: "toolResult",
      toolCallId: "audit",
      toolName: "execute",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: 2,
    });
    for (let iteration = 0; iteration < 3; iteration++) {
      const tracker = new SessionCostTracker(parent.getSessionFile()!, dir);
      const callbackSamples: any[] = [];
      const nativeConsume = (tracker as any).consume;
      (tracker as any).consume = function (session: any, chunk: Buffer) {
        const pendingBytesBefore = session.pendingLength;
        const start = performance.now();
        nativeConsume.call(this, session, chunk);
        const syncMs = performance.now() - start;
        callbackSamples.push({
          syncMs,
          chunkBytes: chunk.length,
          pendingBytesBefore,
          pendingBytesAfter: session.pendingLength,
        });
      };
      const start = performance.now();
      const result = await tracker.refresh();
      const refreshElapsedMs = performance.now() - start;
      if (result !== 0 || callbackSamples.length === 0 || callbackSamples.at(-1).pendingBytesAfter !== 0)
        throw new Error("cost scan skipped/incomplete");
      samples.push({
        name: "footer.SessionCostTracker.refresh",
        payloadBytes,
        inputHash: sha(text),
        iteration,
        fixture: "one-parent-one-child-one-large-tool-result-v1",
        refreshElapsedMs,
        elapsedScope: "whole async operation including disk wait and uninstrumented work; NOT CPU time",
        callbackScope: "synchronous consume entry-to-return after each awaited file read",
        callbackSamples,
        scannedBytes: callbackSamples.reduce((n, s) => n + s.chunkBytes, 0),
        descendantCost: result,
      });
    }
  }
  let failures = 0;
  const recorder = createTaskLifecycleRecorder(join(root, "lifecycle-session.jsonl"), () => {
    failures++;
  });
  for (let iteration = 0; iteration < 20; iteration++) {
    const record = {
      event: "finished",
      at: "2026-01-01T00:00:00.000Z",
      taskId: "audit-task",
      kind: "shell" as const,
      status: "completed" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    const start = performance.now();
    recorder(record);
    samples.push({
      name: "task.lifecycle.record",
      iteration,
      syncMs: performance.now() - start,
      recordHash: sha(JSON.stringify(record)),
      failures,
    });
  }
  if (failures) throw new Error("lifecycle write failed; no success claim");
  const lifecycleOutput = readFileSync(taskLifecycleFile(join(root, "lifecycle-session.jsonl")), "utf8");
  const lifecycleLines = lifecycleOutput.trim().split("\n");
  if (lifecycleLines.length !== 20) throw new Error("lifecycle record count changed");
  const lifecycleWork = {
    recordsWritten: lifecycleLines.length,
    outputBytes: Buffer.byteLength(lifecycleOutput),
    outputHash: sha(lifecycleOutput),
  };
  const sourceFiles = [
    "scripts/terminal-perf/audit-probes/disk-callbacks.ts",
    "src/tasks/session-costs.ts",
    "src/tasks/task-lifecycle.ts",
  ];
  const output = process.argv[2] ?? "artifacts/terminal-perf/audit-disk-callbacks.json";
  await Bun.write(
    output,
    JSON.stringify(
      {
        version: 1,
        lifecycleWork,
        sourceCommit: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(),
        runtime: Bun.version,
        platform: process.platform,
        cpu: cpus()[0]?.model,
        sourceHashes: Object.fromEntries(sourceFiles.map((path) => [path, sha(readFileSync(path))])),
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(output);
  for (const s of samples)
    console.log(
      s.name,
      s.payloadBytes ?? "",
      s.syncMs?.toFixed(3) ??
        "elapsed=" +
          s.refreshElapsedMs.toFixed(3) +
          " callback max=" +
          Math.max(...s.callbackSamples.map((x: any) => x.syncMs)).toFixed(3),
    );
} finally {
  for (const manager of managers) disposeDiskBackedSessionManager(manager);
  rmSync(root, { recursive: true, force: true });
}
