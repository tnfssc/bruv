import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { snapshotSession } from "../scripts/resource-harness/capture";
import { supervise } from "../scripts/resource-harness/supervisor";

const budgets = { rssBytes: 384 * 1024 * 1024, diskBytes: 1024 * 1024, journalEntries: 100, timeoutMs: 10_000 };

async function fixture() {
  await mkdir("artifacts", { recursive: true });
  return mkdtemp(join(process.cwd(), "artifacts", "resource-capture-test-"));
}

test("CoW capture preserves the source and refuses to overwrite a destination", async () => {
  const dir = await fixture();
  try {
    const source = join(dir, "original.jsonl");
    const destination = join(dir, "snapshot.jsonl");
    await writeFile(source, "saved history\n");
    const before = await stat(source);
    try {
      await snapshotSession(source, destination);
    } catch (error) {
      // Ext4 and tmpfs hosts can lack reflink. Capture must fail, not silently copy gigabytes.
      expect(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL"]).toContain(String((error as NodeJS.ErrnoException).code));
      expect(await readFile(source, "utf8")).toBe("saved history\n");
      return;
    }
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    await writeFile(destination, "changed snapshot");
    expect(await readFile(source, "utf8")).toBe("saved history\n");
    expect((await stat(source)).mtimeMs).toBe(before.mtimeMs);
    await expect(snapshotSession(source, destination)).rejects.toThrow();
    expect(await readFile(destination, "utf8")).toBe("changed snapshot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("captured replay exercises real session, native startup and model context without changing original bytes", async () => {
  const dir = await fixture();
  try {
    const snapshot = join(dir, "session.jsonl");
    const root = {
      namespace: "bruv:replay-fixture",
      sourceSessionId: "/fixture/original.jsonl",
      sessionId: "fixture-session",
    };
    const text =
      [
        { type: "session", version: 3, id: "fixture-session", timestamp: new Date(0).toISOString(), cwd: dir },
        {
          type: "custom",
          id: "cursor-1",
          parentId: null,
          timestamp: new Date(0).toISOString(),
          customType: "bruv-native-task-projection",
          data: {
            root,
            cursor: {
              link: {
                jobId: "fixture-job",
                origin: "bruv",
                root,
                sourceId: root.sourceSessionId,
                kind: "shell",
                launchToolUseId: "fixture-call",
                parent: { sourceSessionId: root.sourceSessionId, launchToolUseId: null },
              },
              revision: 1,
              childEntries: [],
            },
          },
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n";
    await writeFile(snapshot, text);
    const result = await supervise({
      command: [process.execPath, join(process.cwd(), "scripts/resource-harness/replay.ts"), snapshot],
      phase: "replay",
      dir,
      budgets,
    });
    expect(result.stderr).toBe("");
    expect(result.passed).toBe(true);
    expect(result.metrics.map((row) => row.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.journalEntries).toBeGreaterThanOrEqual(1);
    expect(result.metrics.map((row) => row.stage)).toContain("connector-storage-restored");
    expect(result.metrics.map((row) => row.stage)).toContain("native-startup-restored");
    expect(result.metrics.map((row) => row.stage)).toContain("model-context-prepared");
    expect((await readFile(snapshot, "utf8")).startsWith(text)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pre-existing captured bytes do not bypass the new-disk-growth watchdog", async () => {
  const dir = await fixture();
  try {
    const script = join(dir, "grow.ts");
    await writeFile(join(dir, "history.jsonl"), Buffer.alloc(8192));
    await writeFile(
      script,
      'await Bun.write(process.argv[2]+"/new-data",Buffer.alloc(4096));setInterval(()=>{},1000);',
    );
    const baselineDiskBytes = 8192 + (await stat(script)).size;
    const result = await supervise({
      command: [process.execPath, script, dir],
      phase: "replay",
      dir,
      budgets: { ...budgets, diskBytes: 2048 },
      baselineDiskBytes,
    });
    expect(result.violations).toContain("Fixture disk budget exceeded");
    expect(result.signal).toBe("SIGKILL");
    expect((await stat(join(dir, "history.jsonl"))).size).toBe(8192);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("existing capture bytes are accepted when no new disk is written", async () => {
  const dir = await fixture();
  try {
    await writeFile(join(dir, "history.jsonl"), Buffer.alloc(8192));
    const script = join(dir, "done.ts");
    await writeFile(
      script,
      'console.log(JSON.stringify({type:"complete",phase:"replay",step:1,rssBytes:1,heapUsedBytes:1,journalBytes:8192,journalEntries:0,elapsedMs:1}));',
    );
    const baselineDiskBytes = 8192 + (await stat(script)).size;
    const result = await supervise({
      command: [process.execPath, script],
      phase: "replay",
      dir,
      budgets: { ...budgets, diskBytes: 1 },
      baselineDiskBytes,
    });
    expect(result.passed).toBe(true);
    expect(result.diskBytes).toBe(baselineDiskBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
