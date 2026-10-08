import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { yieldedEntries } from "./turn-boundaries";

const enabled = process.env.BRUV_RUN_LLM_TESTS === "1";
const binary = resolve(import.meta.dir, "../dist/bruv");

test.skipIf(!enabled)(
  "natural nested-agent workflow returns control before descendants finish",
  async () => {
    const { evidence, sessions, stderr, start, end } = await runNestedWorkflow();
    const artifactDir = resolve(import.meta.dir, "../artifacts/ux");
    await mkdir(artifactDir, { recursive: true });
    const artifact = join(artifactDir, "nested-" + Date.now() + ".json");
    await writeFile(artifact, JSON.stringify({ evidence, sessions, stderr }, null, 2));
    console.log("Nested UX evidence:", artifact);
    expect(sessions.some((s) => s.metadata?.type === "orchestrator" && s.metadata.depth === 1)).toBe(true);
    expect(sessions.filter((s) => s.metadata?.depth === 2 && s.metadata.type === "fast").length).toBeGreaterThanOrEqual(
      2,
    );
    const runner = sessions.find(
      (s) =>
        s.calls.some((c) => c.code?.includes("slow-check.ts") && c.code?.includes("shell(")) && s.metadata?.depth === 2,
    );
    expect(runner).toBeDefined();
    const background = runner!.results.find((r) => r.backgroundJobs.length > 0);
    expect(background).toBeDefined();
    expect(Date.parse(background!.timestamp)).toBeLessThan(end);
    expect(Date.parse(background!.timestamp) - start).toBeLessThan(5000);
    const rootSession = sessions.find((s) => s.name === "parent.jsonl")!;
    expect(rootSession.results.some((r) => Date.parse(r.timestamp) < end)).toBe(true);
    expect(rootSession.stops.some((s) => Date.parse(s.timestamp) < end)).toBe(true);
    expect(runner!.stops.some((s) => Date.parse(s.timestamp) < end)).toBe(true);
    const orchestrator = sessions.find((s) => s.metadata?.type === "orchestrator")!;
    expect(orchestrator.completions).toHaveLength(2);
    expect(rootSession.completions).toHaveLength(1);
    expect(runner!.completions).toHaveLength(1);
    for (const session of sessions) {
      const waitingOnly = session.calls.filter(
        (c) =>
          /jobs\.(inspect|list)\(/.test(c.code ?? "") &&
          !/shell\s*\(|subagent\s*\(|Bun\.file|readFile|node:fs/.test(c.code ?? ""),
      );
      expect(waitingOnly.length).toBeLessThanOrEqual(1);
      expect(waitingOnly.map((c) => c.code).join("\n")).not.toMatch(/Bun\.sleep\(|setTimeout\(/);
    }
    expect(evidence.filter((e) => e.type === "assistant").at(-1)?.text).toContain("PASS");
    console.log(
      JSON.stringify({
        agents: sessions.filter((s) => s.metadata).length,
        checkDurationMs: end - start,
        leafLaunchReturnMs: Date.parse(background!.timestamp) - start,
      }),
    );
  },
  170000,
);

async function runNestedWorkflow() {
  const directory = await mkdtemp(join(tmpdir(), "bruv-nested-ux-"));
  const sessionDir = join(directory, "sessions");
  const evidence: any[] = [];
  let child: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await mkdir(sessionDir);
    await writeFile(
      join(directory, "slow-check.ts"),
      'await Bun.write("check-start", String(Date.now())); await Bun.sleep(15000); await Bun.write("check-end", String(Date.now())); console.log("slow-check: PASS");',
    );
    await writeFile(join(directory, "config.json"), JSON.stringify({ name: "tiny-audit", retries: 3 }));
    await writeFile(
      join(directory, "README.md"),
      "This project validates a slow check and a three-retry configuration.\n",
    );
    child = spawn(
      binary,
      [
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-luna",
        "--thinking",
        process.env.BRUV_UX_THINKING ?? "minimal",
        "--mode",
        "json",
        "--session",
        join(sessionDir, "parent.jsonl"),
        "-p",
        "Delegate to a separate orchestrator subagent, distinct from yourself. Have that subagent coordinate two fast worker subagents: one should run slow-check.ts with Bun and report its actual result, the other should review config.json. Meanwhile, read README.md yourself. Combine the outcomes when all the work is finished. Do not edit project files.",
      ],
      {
        cwd: directory,
        env: { ...process.env, BRUV_SUBAGENT_DEPTH: "0", BRUV_SUBAGENT_TYPE: "" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let pending = "",
      stderr = "";
    child.stdout!.on("data", (chunk) => {
      pending += chunk.toString();
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (["tool_execution_start", "tool_execution_end"].includes(event.type))
            evidence.push({ at: Date.now(), ...event });
          if (event.type === "agent_end") evidence.push({ at: Date.now(), type: event.type });
          if (event.type === "message_end" && event.message?.role === "assistant")
            evidence.push({
              at: Date.now(),
              type: "assistant",
              stopReason: event.message.stopReason,
              text: event.message.content
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join(""),
            });
        } catch {}
      }
    });
    child.stderr!.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    timer = setTimeout(() => child?.kill("SIGTERM"), 150000);
    const exitCode = await new Promise<number | null>((done, fail) => {
      child!.once("exit", done);
      child!.once("error", fail);
    });
    expect(exitCode).toBe(0);
    const sessions = await readSessionTimelines(sessionDir);
    const start = Number(await readFile(join(directory, "check-start"), "utf8"));
    const end = Number(await readFile(join(directory, "check-end"), "utf8"));
    return { evidence, sessions, stderr, start, end };
  } finally {
    if (timer) clearTimeout(timer);
    child?.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  }
}

async function readSessionTimelines(sessionDir: string) {
  const sessions = [];
  for (const name of await readdir(sessionDir)) {
    // Task lifecycle journals share the directory, but are not Pi transcripts.
    if (!name.endsWith(".jsonl") || name.endsWith(".jobs.jsonl")) continue;
    const entries = (await readFile(join(sessionDir, name), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    sessions.push(sessionTimeline(name, entries));
  }
  return sessions;
}

function sessionTimeline(name: string, entries: any[]) {
  const metadata = entries.find((e) => e.type === "custom" && e.customType === "bruv-agent")?.data;
  const messages = entries.filter((e) => e.type === "message");
  const calls = messages.flatMap((e) =>
    e.message.role === "assistant"
      ? (e.message.content ?? [])
          .filter((p: any) => p.type === "toolCall")
          .map((p: any) => ({ timestamp: e.timestamp, id: p.id, code: p.arguments?.code }))
      : [],
  );
  const results = messages
    .filter((e) => e.message.role === "toolResult")
    .map((e) => ({
      timestamp: e.timestamp,
      id: e.message.toolCallId,
      stdout: e.message.details?.stdout,
      backgroundJobs: e.message.details?.backgroundJobs ?? [],
      isError: e.message.isError,
    }));
  const stops = yieldedEntries(messages).map((e) => ({ timestamp: e.timestamp }));
  const completions = entries
    .filter((e) => e.customType === "task-complete")
    .map((e) => ({ timestamp: e.timestamp, tasks: e.details?.tasks }));
  return { name, metadata, calls, results, stops, completions };
}

test("session timeline keeps launch, yield and completion evidence distinct", () => {
  const metadata = { type: "fast", depth: 2, taskId: "task_leaf" };
  const callAt = "2026-01-01T00:00:00Z";
  const firstResultAt = "2026-01-01T00:00:01Z";
  const yieldAt = "2026-01-01T00:00:02Z";
  const completeAt = "2026-01-01T00:00:15Z";
  const tasks = [{ id: "task_shell", status: "completed" }];
  const entries = [
    { type: "custom", customType: "bruv-agent", data: metadata },
    {
      type: "message",
      timestamp: callAt,
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "text", text: "Starting the check" },
          { type: "toolCall", id: "launch", arguments: { code: "await shell('bun slow-check.ts')" } },
          { type: "toolCall", id: "read", arguments: { code: "await Bun.file('config.json').text()" } },
        ],
      },
    },
    {
      type: "message",
      timestamp: firstResultAt,
      message: {
        role: "toolResult",
        toolCallId: "launch",
        isError: false,
        details: { stdout: "started", backgroundJobs: ["task_shell"], handoff: "Progress" },
      },
    },
    {
      type: "message",
      timestamp: yieldAt,
      message: { role: "toolResult", toolCallId: "read", isError: false, details: { handoff: "Progress" } },
    },
    { type: "custom_message", customType: "task-attention", timestamp: yieldAt },
    { type: "custom_message", customType: "task-complete", timestamp: completeAt, details: { tasks } },
    {
      type: "message",
      timestamp: completeAt,
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "PASS" }] },
    },
  ];
  const timeline = sessionTimeline("leaf.jsonl", entries);
  expect(timeline.name).toBe("leaf.jsonl");
  expect(timeline.metadata).toEqual(metadata);
  expect(timeline.calls).toEqual([
    { timestamp: callAt, id: "launch", code: "await shell('bun slow-check.ts')" },
    { timestamp: callAt, id: "read", code: "await Bun.file('config.json').text()" },
  ]);
  expect(timeline.results).toEqual([
    { timestamp: firstResultAt, id: "launch", stdout: "started", backgroundJobs: ["task_shell"], isError: false },
    { timestamp: yieldAt, id: "read", stdout: undefined, backgroundJobs: [], isError: false },
  ]);
  expect(timeline.stops).toEqual([{ timestamp: yieldAt }, { timestamp: completeAt }]);
  expect(timeline.completions).toEqual([{ timestamp: completeAt, tasks }]);
  expect(sessionTimeline("parent.jsonl", entries.slice(1)).metadata).toBeUndefined();
});

test("session collection does not mistake task journals for the root transcript", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "bruv-ux-transcripts-"));
  try {
    const header = { type: "session" };
    const rootStop = {
      type: "message",
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "assistant", stopReason: "stop", content: [] },
    };
    await writeFile(join(sessionDir, "parent.jsonl"), [header, rootStop].map((e) => JSON.stringify(e)).join("\n"));
    await writeFile(
      join(sessionDir, "child.jsonl"),
      [header, { type: "custom", customType: "bruv-agent", data: { type: "fast", depth: 2 } }]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    // An unmarked sidecar reproduced the old first-unmarked-session selection.
    await writeFile(join(sessionDir, "child.jsonl.jobs.jsonl"), JSON.stringify({ event: "completed" }));
    await writeFile(join(sessionDir, "parent.jsonl.jobs.jsonl"), JSON.stringify({ event: "completed" }));
    const sessions = await readSessionTimelines(sessionDir);
    expect(sessions.map((s) => s.name).sort()).toEqual(["child.jsonl", "parent.jsonl"]);
    expect(sessions.find((s) => s.name === "parent.jsonl")?.stops).toEqual([{ timestamp: rootStop.timestamp }]);
    expect(sessions.find((s) => s.name === "child.jsonl")?.metadata).toEqual({ type: "fast", depth: 2 });
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});
