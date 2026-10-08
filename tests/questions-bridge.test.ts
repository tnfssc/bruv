import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QuestionService } from "../src/questions/service";
import { executeIsolated } from "../src/typescript/execution";

import { ownedProcessSuite } from "./owned-process-suite";

ownedProcessSuite(import.meta.path, () => {
  // The parent owns persistence; the child exercises only the public bridge helpers.
  async function executeQuestionScenario(code: string) {
    const dir = mkdtempSync(join(tmpdir(), "bruv-question-bridge-"));
    const service = new QuestionService();
    const ctx = {
      sessionManager: {
        getSessionId: () => "session",
        getSessionFile: () => join(dir, "session.jsonl"),
        getLeafId: () => "root",
        getBranch: () => [{ id: "root" }],
      },
    };
    const result = await executeIsolated(code, process.cwd(), undefined, 5000, {
      executablePath: resolve(import.meta.dir, "../dist/bruv"),
      jobHandler: async (method, params) => service.handle(method, params, ctx),
    });
    // Snapshot persistence while retaining the owned directory for inspection.
    return { result, savedQuestions: service.list(ctx) };
  }

  test("real isolated execute asks without waiting and exposes block/read/resolve, not answer", async () => {
    const { result, savedQuestions } = await executeQuestionScenario(
      `
    const q = await questions.ask({
      text: "Pick target?",
      choices: ["A", "B"],
      dedupKey: "target",
    });
    console.log("independent work still runs");

    const blocked = await questions.block({
      id: q.id,
      owner: q.owner,
      version: q.version,
      checkpoint: "Need deployment target",
      foreground: true,
    });
    console.log(JSON.stringify(await questions.get(q.id)));
    console.log(typeof questions.answer);
    console.log(JSON.stringify(await questions.list()));

    await questions.resolve({
      id: blocked.id,
      owner: blocked.owner,
      version: blocked.version,
      reason: "Test finished",
    });
    `,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("independent work still runs");
    expect(result.stdout).toContain('"foreground":true');
    expect(result.stdout).toContain("undefined");
    expect(savedQuestions[0]!.status).toBe("resolved");
  });

  test("actual isolated questions helper returns actionable results and rejects stale writes", async () => {
    const { result } = await executeQuestionScenario(
      `
    // Expose actionable records, but no agent-side answer helper.
    const a = await questions.ask({ text: "First?" });
    const b = await questions.ask({ text: "Second?" });
    console.log("ASK", JSON.stringify(a));
    console.log("LIST", JSON.stringify(await questions.list()));
    console.log("GET", JSON.stringify(await questions.get(a.id)));
    console.log("ANSWER_HELPER", typeof questions.answer);

    // Cancellation changes the version; replaying the old write must fail.
    const closed = await questions.cancel({ id: b.id, owner: b.owner, version: b.version });
    console.log("CANCEL", JSON.stringify(closed));
    try {
      await questions.cancel({ id: b.id, owner: b.owner, version: b.version });
    } catch (e) {
      console.log("STALE", e.message);
    }

    // One original question remains active, so nineteen more reach the cap.
    for (let i = 0; i < 19; i++) await questions.ask({ text: "Extra " + i });
    try {
      await questions.ask({ text: "Overflow" });
    } catch (e) {
      console.log("CAP", e.message);
    }
    `,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ANSWER_HELPER undefined");
    expect(result.stdout).toContain("STALE Stale question version: current 2");
    expect(result.stdout).toContain("CAP Too many active questions (20). Answer or cancel a pending question first.");
    expect(result.stdout).toContain("CANCEL");
    expect(result.stdout).toContain("LIST");
  });
});
