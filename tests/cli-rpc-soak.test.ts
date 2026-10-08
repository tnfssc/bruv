import { expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const source = resolve(import.meta.dir, "../scripts/leak-audit/cli-rpc-soak.ts");

// Exercise the complete entry point without building or contacting a provider.
// The fake speaks the shipped JSONL protocol, including prompt/abort end events.
const fakeCli = String.raw`
import { createInterface } from "node:readline";
await Bun.write(process.env.SOAK_TEST_PID, String(process.pid));
const commands = [];
async function emit(event) {
  const line = JSON.stringify(event) + "\n";
  await Bun.stdout.write(line.slice(0, 8));
  await Bun.sleep(1);
  await Bun.stdout.write(line.slice(8));
}
console.log("non-JSON startup diagnostic");
console.log("");
for await (const line of createInterface({ input: process.stdin })) {
  const command = JSON.parse(line);
  commands.push(command);
  await Bun.write(process.env.SOAK_TEST_COMMANDS, JSON.stringify(commands));
  const error = command.type === "compact" ? process.env.SOAK_TEST_COMPACT_ERROR :
    command.type === "prompt" ? process.env.SOAK_TEST_PROMPT_ERROR : undefined;
  await emit({ type: "response", id: command.id, command: command.type, success: !error, ...(error ? { error } : {}) });
  if (command.type === "prompt" && !error && !command.message.includes("SOAK_ABORT_ME")) {
    await emit({ type: "message_end", message: { content: "ok" } });
    await emit({ type: "agent_end" });
  }
  if (command.type === "abort") await emit({ type: "agent_end" });
}
console.error("fake CLI drained");
process.exit(Number(process.env.SOAK_TEST_EXIT_CODE ?? 0));
`;

type ProbeOptions = {
  cycles?: number;
  newOnly?: boolean;
  compactError?: string;
  promptError?: string;
  exitCode?: number;
};

async function probe(options: ProbeOptions = {}) {
  const fixture = await mkdtemp("/var/tmp/bruv-cli-soak-test-");
  let runRoot: string | undefined;
  let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  try {
    await mkdir(join(fixture, "scripts/leak-audit"), { recursive: true });
    await mkdir(join(fixture, "dist"));
    await copyFile(source, join(fixture, "scripts/leak-audit/cli-rpc-soak.ts"));
    const binary = join(fixture, "dist/bruv");
    await writeFile(binary, "#!" + process.execPath + "\n" + fakeCli);
    await chmod(binary, 0o700);
    child = Bun.spawn([process.execPath, join(fixture, "scripts/leak-audit/cli-rpc-soak.ts")], {
      env: {
        ...process.env,
        BRUV_SOAK_CYCLES: String(options.cycles ?? 20),
        BRUV_SOAK_NEW_ONLY: options.newOnly ? "1" : "0",
        SOAK_TEST_COMMANDS: join(fixture, "commands.json"),
        SOAK_TEST_PID: join(fixture, "pid"),
        SOAK_TEST_COMPACT_ERROR: options.compactError ?? "Nothing to compact",
        SOAK_TEST_PROMPT_ERROR: options.promptError ?? "",
        SOAK_TEST_EXIT_CODE: String(options.exitCode ?? 0),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    const watchdog = setTimeout(() => child?.kill(), 4_000);
    let exitCode: number;
    try {
      exitCode = await child.exited;
    } finally {
      clearTimeout(watchdog);
    }
    const output = await stdout;
    const errors = await stderr;
    const report = output.trim() ? JSON.parse(output) : undefined;
    runRoot = report?.root ?? errors.match(/artifacts: (\S+)/)?.[1];
    const pid = Number(await readFile(join(fixture, "pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    const commands = JSON.parse(await readFile(join(fixture, "commands.json"), "utf8"));
    if (report) {
      expect(JSON.parse(await readFile(join(runRoot!, "report.json"), "utf8"))).toEqual(report);
    }
    return { exitCode, errors, report, commands };
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await child.exited;
    }
    await rm(fixture, { recursive: true, force: true });
    if (runRoot) await rm(runRoot, { recursive: true, force: true });
  }
}

test("mixed soak owns prompt/abort completion, samples replacement, and drains its report", async () => {
  const { exitCode, report, commands } = await probe();
  expect(exitCode).toBe(0);
  expect(report.exitCode).toBe(0);
  expect(report.cycles).toBe(20);
  expect(report.requestCount).toBe(0);
  expect(report.eventCount).toBe(63);
  expect(report.stderr).toContain("fake CLI drained");
  expect(report.failedResponses).toEqual([
    { type: "response", id: "c18", command: "compact", success: false, error: "Nothing to compact" },
  ]);
  expect(report.samples.map((sample: any) => sample.label)).toEqual(["start", "post-new-20", "final"]);
  expect(commands.map((command: any) => command.type)).toEqual([
    "get_state",
    ...Array(12).fill("prompt"),
    "abort",
    ...Array(3).fill("prompt"),
    "compact",
    ...Array(5).fill("prompt"),
    "new_session",
  ]);
});

test("replacement-only probe sends no turns or compaction", async () => {
  const { exitCode, report, commands } = await probe({ newOnly: true });
  expect(exitCode).toBe(0);
  expect(report.eventCount).toBe(21);
  expect(report.failedResponses).toEqual([]);
  expect(commands.map((command: any) => command.type)).toEqual(["get_state", ...Array(20).fill("new_session")]);
  expect(report.samples.map((sample: any) => sample.label)).toEqual(["start", "post-new-20", "final"]);
});

test("only the two documented compact failures are tolerated", async () => {
  const cancelled = await probe({ cycles: 15, compactError: "Compaction cancelled" });
  expect(cancelled.exitCode).toBe(0);
  expect(cancelled.report.failedResponses[0].error).toBe("Compaction cancelled");
  const unexpected = await probe({ cycles: 15, compactError: "synthetic compact failure" });
  expect(unexpected.exitCode).toBe(1);
  expect(unexpected.report.failedResponses[0].error).toBe("synthetic compact failure");
});

test("nonzero CLI exit is still a failing soak with a complete report", async () => {
  const { exitCode, report } = await probe({ cycles: 1, exitCode: 7 });
  expect(exitCode).toBe(1);
  expect(report.exitCode).toBe(7);
  expect(report.eventCount).toBe(4);
  expect(report.stderr).toContain("fake CLI drained");
});

test("rejected prompt releases the end timer and awaits exact-child teardown", async () => {
  const { exitCode, errors, report } = await probe({ cycles: 1, promptError: "synthetic prompt rejection" });
  expect(exitCode).toBe(1);
  expect(report).toBeUndefined();
  expect(errors).toContain("synthetic prompt rejection");
  expect(errors).toContain("artifacts:");
  expect(errors).not.toContain("timeout agent_end");
});
