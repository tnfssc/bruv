import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRemoteRuntime } from "../src/remote/runtime";

test("owner completion checkpoint reads actual paged jobs and pending-message state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-runtime-"));
  const previous = process.env.DIE_REMOTE_RUNTIME_STATE;
  process.env.DIE_REMOTE_RUNTIME_STATE = join(dir, "runtime.json");
  try {
    const handlers = new Map<string, Function>();
    let pages = 0;
    registerRemoteRuntime({
      registerCommand() {},
      on: (event: string, fn: Function) => handlers.set(event, fn),
      events: {
        emit: (_name: string, request: any) =>
          request.accept({
            list: async () =>
              ++pages === 1 ? { jobs: [{ status: "completed" }], nextCursor: 1 } : { jobs: [{ status: "running" }] },
          }),
      },
    } as any);
    await handlers.get("agent_start")!();
    expect(JSON.parse(readFileSync(process.env.DIE_REMOTE_RUNTIME_STATE!, "utf8"))).toEqual({ settled: false });
    await handlers.get("agent_settled")!(
      {},
      { hasPendingMessages: () => true, sessionManager: { getLeafId: () => null, getSessionFile: () => "/session" } },
    );
    expect(JSON.parse(readFileSync(process.env.DIE_REMOTE_RUNTIME_STATE!, "utf8"))).toMatchObject({
      settled: true,
      activeJobs: 1,
      pendingMessages: true,
      questions: [],
    });
    expect(pages).toBe(2);
  } finally {
    if (previous === undefined) delete process.env.DIE_REMOTE_RUNTIME_STATE;
    else process.env.DIE_REMOTE_RUNTIME_STATE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
