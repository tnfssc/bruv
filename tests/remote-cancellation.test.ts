import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRemoteCancellationRuntime, registerRemoteCancellationService } from "../src/remote/cancellation";
import { registerSessionHost } from "../src/session/host-access";

async function withCancellation(run: (dir: string, pi: any, command: (ctx: any) => Promise<void>) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "remote-cancellation-"));
  const previous = process.env.BRUV_REMOTE_RUNTIME_STATE;
  process.env.BRUV_REMOTE_RUNTIME_STATE = join(dir, "runtime.json");
  try {
    let handler: Function;
    const pi = {
      events: new EventEmitter(),
      registerCommand: (name: string, command: { handler: Function }) => {
        expect(name).toBe("bruv-remote-cancel");
        handler = command.handler;
      },
    };
    registerRemoteCancellationRuntime(pi as any);
    await run(dir, pi, (ctx) => handler("", ctx));
  } finally {
    if (previous === undefined) delete process.env.BRUV_REMOTE_RUNTIME_STATE;
    else process.env.BRUV_REMOTE_RUNTIME_STATE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

function report(dir: string) {
  return JSON.parse(readFileSync(join(dir, "cancel-report.json"), "utf8"));
}

test("cancellation receives stop report before abort and captures every page before declaring settlement", async () => {
  await withCancellation(async (dir, pi, command) => {
    const effects: string[] = [];
    const stopReport = { discoveryCompleted: true, pending: ["job_b"] };
    let release!: (value: unknown) => void;
    let scans = 0;
    const ctx = {
      abort: () => effects.push("abort"),
      isIdle: () => {
        effects.push("idle");
        expect(readFileSync(join(dir, "session.jsonl.artifacts", "execute-job-job_b", "stdout.log"), "utf8")).toBe(
          "output job_b",
        );
        return true;
      },
    };
    registerRemoteCancellationService(pi, async (received) => {
      expect(received).toBe<typeof ctx>(ctx);
      effects.push("stop");
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    registerSessionHost(pi, () => {
      effects.push("host");
      return {
        list: async ({ cursor }: { cursor?: number }) => {
          effects.push("list:" + String(cursor));
          if (cursor === undefined) {
            scans++;
            return { jobs: [{ id: "job_a", status: "completed" }], nextCursor: 1 };
          }
          return { jobs: [{ id: "job_b", status: scans === 1 ? "running" : "cancelled" }] };
        },
        inspect: async (id: string) => {
          effects.push("inspect:" + id);
          return { output: "output " + id, hasMore: false };
        },
      } as any;
    });
    const running = command(ctx);
    expect(effects).toEqual(["stop"]);
    expect(existsSync(join(dir, "cancel-report.json"))).toBe(false);
    release(stopReport);
    await running;
    expect(effects).toEqual([
      "stop",
      "abort",
      "host",
      "list:undefined",
      "inspect:job_a",
      "list:1",
      "list:undefined",
      "inspect:job_a",
      "list:1",
      "inspect:job_b",
      "idle",
    ]);
    expect(report(dir)).toEqual({ at: expect.any(String), report: stopReport, settled: true });
    expect(statSync(join(dir, "cancel-report.json")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(dir, "cancel-report.json." + process.pid))).toBe(false);
  });
});

test("service rejection publishes an unconfirmed error without aborting foreground", async () => {
  await withCancellation(async (dir, pi, command) => {
    registerRemoteCancellationService(pi, async () => {
      throw Error("stop rejected");
    });
    let aborted = false;
    await command({
      abort: () => {
        aborted = true;
      },
    });
    expect(aborted).toBe(false);
    expect(report(dir)).toMatchObject({ report: { error: "Error: stop rejected" }, settled: false });
  });
});

test("repeated job cursor cannot declare settlement from an incomplete inspection", async () => {
  await withCancellation(async (dir, pi, command) => {
    registerRemoteCancellationService(pi, async () => ({ requested: true }));
    let pages = 0;
    registerSessionHost(
      pi,
      () =>
        ({
          list: async () => {
            pages++;
            return { jobs: [], nextCursor: "same" };
          },
        }) as any,
    );
    let aborted = false;
    await command({
      abort: () => {
        aborted = true;
      },
      isIdle: () => true,
    });
    expect(aborted).toBe(true);
    expect(pages).toBe(2);
    expect(report(dir)).toMatchObject({
      report: { error: "Error: Cancellation job inspection incomplete" },
      settled: false,
    });
  });
});

test("bounded inspection retains the stop report but does not confuse idle jobs with idle foreground", async () => {
  await withCancellation(async (dir, pi, command) => {
    const stopReport = { acknowledged: true };
    registerRemoteCancellationService(pi, async () => stopReport);
    let scans = 0;
    registerSessionHost(
      pi,
      () =>
        ({
          list: async () => {
            scans++;
            return { jobs: [] };
          },
        }) as any,
    );
    let aborted = false;
    await command({
      abort: () => {
        aborted = true;
      },
      isIdle: () => false,
    });
    expect(aborted).toBe(true);
    expect(scans).toBe(50);
    expect(report(dir)).toMatchObject({ report: stopReport, settled: false });
  });
}, 10_000);
