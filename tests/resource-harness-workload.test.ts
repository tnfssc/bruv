import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../scripts/resource-harness/workload.ts");
interface Counts {
  tasks: number;
  updates: number;
  childEntries: number;
}
interface Metric {
  type: "sample" | "complete";
  phase: "write" | "resume";
  step: number;
  rssBytes: number;
  heapUsedBytes: number;
  journalBytes: number;
  journalEntries: number;
  elapsedMs: number;
}
async function invoke(dir: string, phase: "write" | "resume", counts: Counts, extra: string[] = []) {
  const child = Bun.spawn(
    [
      process.execPath,
      script,
      "--dir",
      dir,
      "--tasks",
      String(counts.tasks),
      "--updates",
      String(counts.updates),
      "--child-entries",
      String(counts.childEntries),
      "--phase",
      phase,
      ...extra,
    ],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, HERDR_ENV: "0" } },
  );
  // Bound every child independently, including a broken binding or SDK import.
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  } finally {
    clearTimeout(timer);
  }
}
async function run(dir: string, phase: "write" | "resume", counts: Counts): Promise<Metric[]> {
  const result = await invoke(dir, phase, counts);
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  const rows: Metric[] = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(rows.at(-1)?.type).toBe("complete");
  expect(rows.filter((row) => row.type === "complete")).toHaveLength(1);
  let previousTime = 0;
  for (const row of rows) {
    expect(row.phase).toBe(phase);
    expect(["sample", "complete"]).toContain(row.type);
    for (const key of ["step", "rssBytes", "heapUsedBytes", "journalBytes", "journalEntries", "elapsedMs"] as const) {
      expect(Number.isFinite(row[key])).toBe(true);
      expect(row[key]).toBeGreaterThanOrEqual(0);
    }
    expect(row.rssBytes).toBeGreaterThan(0);
    expect(row.elapsedMs).toBeGreaterThanOrEqual(previousTime);
    previousTime = row.elapsedMs;
  }
  return rows;
}
const jsonl = (bytes: Buffer) =>
  bytes
    .toString()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}

test("real task history is measured; fresh-process resume preserves originals and deduplicates replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resource-workload-"));
  const counts = { tasks: 2, updates: 4, childEntries: 3 };
  try {
    const written = await run(dir, "write", counts);
    const fixture = JSON.parse(await readFile(join(dir, "fixture.json"), "utf8"));
    const rootPath = fixture.root.sourceSessionId;
    const original = await readFile(rootPath);
    const ledger = jsonl(original);
    const checkpoints = ledger.filter(
      (entry) => entry.type === "custom" && entry.customType === "bruv-native-task-projection",
    );
    expect(checkpoints.length).toBeGreaterThanOrEqual(counts.tasks);
    expect(checkpoints.length).toBeLessThanOrEqual(counts.tasks * (counts.updates + 1));
    expect(ledger).toHaveLength(2 + checkpoints.length); // header, launch user, snapshots
    expect(written.at(-1)?.journalBytes).toBe(original.length);
    expect(written.at(-1)?.journalEntries).toBe(ledger.length);
    const ids = new Set<string>();
    for (const entry of ledger.slice(1)) {
      expect(entry.parentId).toBe(ids.size ? ledger[ids.size].id : null);
      ids.add(entry.id);
    }
    expect(ids.size).toBe(ledger.length - 1);
    for (const task of fixture.tasks) {
      const snapshots = checkpoints.filter((entry) => entry.data.cursor.link.jobId === task.id);
      expect(snapshots.at(-1).data.cursor.revision).toBeGreaterThanOrEqual(1);
      const child = jsonl(await readFile(task.agent.sessionFile));
      expect(child).toHaveLength(2 + counts.updates * counts.childEntries);
      expect(snapshots.at(-1).data.cursor.childEntries).toBeUndefined();
      expect(snapshots.at(-1).data.cursor.childOffset).toBe((await readFile(task.agent.sessionFile)).length);
    }
    // Resource ceilings live in the supervisor. Do not require quadratic snapshots to survive a fix.
    const nativePaths = (await files(join(dir, "native"))).filter((path) => path.endsWith(".jsonl"));
    expect(nativePaths).toHaveLength(counts.tasks + 1);
    const sidechains = nativePaths.filter((path) => path.includes("/subagents/"));
    for (const path of sidechains) {
      const entries = jsonl(await readFile(path));
      expect(entries).toHaveLength(1 + counts.updates * counts.childEntries);
      expect(entries.every((entry) => entry.isSidechain === true)).toBe(true);
      expect(new Set(entries.map((entry) => entry.bruv.sourceMessageId)).size).toBe(entries.length);
      const task = fixture.tasks.find((task: any) => task.agent.sessionFile === entries[0].bruv.sourceSessionId);
      expect(task).toBeDefined();
      const source = jsonl(await readFile(task.agent.sessionFile)).slice(1);
      expect(entries.map((entry) => entry.message.content)).toEqual(source.map((entry) => entry.message.content));
    }
    const preserved = await Promise.all(
      [...nativePaths, ...fixture.tasks.map((task: any) => task.agent.sessionFile), join(dir, "fixture.json")].map(
        async (path) => ({ path, digest: hash(await readFile(path)) }),
      ),
    );
    const resumed = await run(dir, "resume", counts); // A NEW Bun process, no shared cache.
    expect(resumed.find((row) => row.step === 1)?.journalBytes).toBe(original.length);
    expect(resumed.find((row) => row.step === 1)?.journalEntries).toBe(ledger.length);
    const after = await readFile(rootPath);
    expect(after.subarray(0, original.length).equals(original)).toBe(true);
    expect(resumed.at(-1)?.journalBytes).toBe(after.length);
    expect(resumed.at(-1)?.journalEntries).toBeLessThanOrEqual(ledger.length + counts.tasks);
    expect(resumed.at(-1)?.journalEntries).toBe(jsonl(after).length);
    const resumedSnapshots = jsonl(after).slice(ledger.length);
    expect(resumedSnapshots.length).toBeLessThanOrEqual(counts.tasks);

    for (const { path, digest } of preserved) expect(hash(await readFile(path))).toBe(digest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("metrics are batched and report the actual persistent ledger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resource-batches-"));
  const counts = { tasks: 1, updates: 45, childEntries: 0 };
  try {
    const rows = await run(dir, "write", counts);
    expect(rows.length).toBeLessThanOrEqual(24);
    expect(rows.at(-1)?.step).toBe(counts.updates + 2);
    expect(rows.at(-1)?.journalEntries).toBeLessThanOrEqual(2 + counts.tasks * (counts.updates + 1));
    const fixture = JSON.parse(await readFile(join(dir, "fixture.json"), "utf8"));
    const snapshots = jsonl(await readFile(fixture.root.sourceSessionId)).slice(2);
    expect(snapshots.every((entry) => entry.data.cursor.childEntries === undefined)).toBe(true);
    expect(snapshots.every((entry) => entry.data.cursor.childOffset > 0)).toBe(true);
    expect(rows.at(-1)?.journalEntries).toBe(jsonl(await readFile(fixture.root.sourceSessionId)).length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

test("zero updates is resumable; reuse, wrong counts and invalid arguments do not overwrite the fixture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resource-preserve-"));
  const counts = { tasks: 1, updates: 0, childEntries: 0 };
  try {
    const write = await run(dir, "write", counts);
    expect(write.at(-1)?.journalEntries).toBe(3);
    const resume = await run(dir, "resume", counts);
    expect(resume.at(-1)?.journalEntries).toBeLessThanOrEqual(4);
    const before = await Promise.all(
      (await files(dir)).map(async (path) => ({ path, digest: hash(await readFile(path)) })),
    );
    const reuse = await invoke(dir, "write", counts);
    expect(reuse.code).not.toBe(0);
    expect(reuse.stderr).toContain("EEXIST");
    const mismatch = await invoke(dir, "resume", { ...counts, updates: 1 });
    expect(mismatch.code).not.toBe(0);
    expect(mismatch.stderr).toContain("Resume counts must match");
    const invalid = await invoke(dir, "write", { ...counts, tasks: -1 });
    expect(invalid.code).not.toBe(0);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toContain("--tasks must be an integer");
    const unknown = await invoke(dir, "write", counts, ["--unexpected", "1"]);
    expect(unknown.code).not.toBe(0);
    expect(unknown.stdout).toBe("");
    for (const { path, digest } of before) expect(hash(await readFile(path))).toBe(digest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("legacy child ID snapshots migrate once without replay or rewriting originals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resource-legacy-"));
  const counts = { tasks: 1, updates: 3, childEntries: 1 };
  try {
    await run(dir, "write", counts);
    const fixture = JSON.parse(await readFile(join(dir, "fixture.json"), "utf8"));
    const path = fixture.root.sourceSessionId;
    const ledger = jsonl(await readFile(path));
    const latest = structuredClone(ledger.at(-1));
    const childPath = fixture.tasks[0].agent.sessionFile;
    const child = await readFile(childPath);
    latest.id = "legacy-cursor-fixture";
    latest.parentId = ledger.at(-1).id;
    latest.data.cursor.childEntries = jsonl(child)
      .slice(1)
      .map((entry) => entry.id);
    delete latest.data.cursor.childOffset;
    await appendFile(path, JSON.stringify(latest) + "\n");
    const before = await readFile(path);
    const nativePaths = (await files(join(dir, "native"))).filter((path) => path.endsWith(".jsonl"));
    const digests = await Promise.all(nativePaths.map(async (path) => hash(await readFile(path))));
    await run(dir, "resume", counts);
    const after = await readFile(path);
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    expect(await readFile(childPath)).toEqual(child);
    const migrated = jsonl(after).at(-1).data.cursor;
    expect(migrated.childEntries).toBeUndefined();
    expect(migrated.legacyCursorId).toBeUndefined();
    expect(migrated.childOffset).toBe(child.length);
    for (const [index, path] of nativePaths.entries()) expect(hash(await readFile(path))).toBe(digests[index]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("stable-history rounds repeat task updates without inventing new child messages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-resource-stable-history-"));
  const counts = { tasks: 1, updates: 20, childEntries: 2 };
  try {
    const written = await invoke(dir, "write", counts, ["--child-updates", "3"]);
    expect(written.code).toBe(0);
    const fixture = JSON.parse(await readFile(join(dir, "fixture.json"), "utf8"));
    expect(fixture.counts.childUpdates).toBe(3);
    const childPath = fixture.tasks[0].agent.sessionFile;
    const before = await readFile(childPath);
    expect(jsonl(before)).toHaveLength(8); // header, seed, six new messages
    const resumed = await invoke(dir, "resume", counts, ["--child-updates", "3"]);
    expect(resumed.stderr).toBe("");
    expect(resumed.code).toBe(0);
    expect((await readFile(childPath)).equals(before)).toBe(true);
    const invalid = await invoke(dir, "resume", counts, ["--child-updates", "21"]);
    expect(invalid.code).not.toBe(0);
    expect(invalid.stderr).toContain("must not exceed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
