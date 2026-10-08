import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuestionService } from "../src/questions/service";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "bruv-questions-"));
  let leaf = "root";
  const entries: Array<{ id: string; parentId: string | null; type?: string; customType?: string }> = [
    { id: "root", parentId: null },
  ];
  const file = join(dir, "s.jsonl");
  const ctx = {
    sessionManager: {
      getSessionId: () => "s",
      getSessionFile: () => file,
      getLeafId: () => leaf,
      getBranch: () => {
        const branch = [];
        let id: string | null = leaf;
        while (id) {
          const e = entries.find((e) => e.id === id);
          if (!e) break;
          branch.unshift(e);
          id = e.parentId;
        }
        return branch;
      },
      getEntries: () => entries,
    },
  };
  return {
    ctx,
    file,
    move(id: string, parent: string, type?: string, customType?: string) {
      entries.push({ id, parentId: parent, type, customType });
      leaf = id;
    },
    navigate(id: string) {
      leaf = id;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("a nonblocking question can be blocked, answered idempotently, and queued across reloads", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    const question = await service.ask(f.ctx, {
      text: "Pick",
      choices: ["A", "B"],
      allowFreeText: false,
      requester: "analyst",
      taskIds: ["t1"],
      reason: "Need input",
      dedupKey: "k",
    });
    expect(question.blocked).toBeUndefined();
    expect(new QuestionService().get(f.ctx, question.id).requester).toBe("analyst");
    const blocked = await service.block(f.ctx, {
      id: question.id,
      owner: question.owner,
      version: question.version,
      checkpoint: "Await selection",
      foreground: true,
      taskIds: ["t1"],
    });
    expect(blocked.blocked?.checkpoint).toBe("Await selection");
    await expect(
      service.answer(f.ctx, { id: question.id, owner: question.owner, version: blocked.version, text: "wrong" }),
    ).rejects.toThrow("choice");
    const reply = {
      id: question.id,
      owner: question.owner,
      version: blocked.version,
      text: "A",
      replyId: "ui-event-1",
    };
    const answered = await service.answer(f.ctx, reply);
    expect(answered.delivery).toBe("resume-needed");
    expect(answered.replyId).toBe("ui-event-1");
    expect(await service.answer(f.ctx, reply)).toEqual(answered);
    await expect(service.answer(f.ctx, { ...reply, text: "B" })).rejects.toThrow("Stale");
    const queued = await service.setDelivery(f.ctx, {
      id: question.id,
      owner: question.owner,
      version: answered.version,
      delivery: "queued",
    });
    expect(new QuestionService().get(f.ctx, question.id).delivery).toBe("queued");
    expect(queued.version).toBe(answered.version + 1);
  } finally {
    f.cleanup();
  }
});

test("optional questions can be resolved without letting agent tools supply an answer", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    const question = await service.ask(f.ctx, { text: "Optional", choices: ["Y"], allowFreeText: true });
    expect(() => service.handle("questions.answer", { id: question.id }, f.ctx)).toThrow("UI reply only");
    const resolved = await service.resolve(f.ctx, {
      id: question.id,
      owner: question.owner,
      version: question.version,
      reason: "No longer needed",
    });
    expect(resolved.resolutionReason).toBe("No longer needed");
  } finally {
    f.cleanup();
  }
});

test("dedup follows the owner's continuation, but a sibling fork creates its own question", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    const question = await service.ask(f.ctx, { text: "What?", dedupKey: "request" });
    f.move("original", "root");
    f.move("progress", "original");
    expect((await service.ask(f.ctx, { text: "What?", dedupKey: "request" })).id).toBe(question.id);
    f.move("sibling", "root");
    expect(service.get(f.ctx, question.id).id).toBe(question.id);
    await expect(
      service.answer(f.ctx, { id: question.id, owner: question.owner, version: question.version, text: "no" }),
    ).rejects.toThrow("owner branch");
    expect((await service.ask(f.ctx, { text: "What?", dedupKey: "request" })).id).not.toBe(question.id);
  } finally {
    f.cleanup();
  }
});

test("answer revalidates navigation after waiting for the question ledger lock", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    const question = await service.ask(f.ctx, { text: "What?" });
    f.move("original", "root");
    f.move("progress", "original");
    f.move("sibling", "root");
    f.navigate("progress");
    const lock = f.file + ".questions.json.lock";
    writeFileSync(lock, "held");
    const pending = service.answer(f.ctx, {
      id: question.id,
      owner: question.owner,
      version: question.version,
      text: "late",
    });
    await Bun.sleep(40);
    f.navigate("sibling");
    unlinkSync(lock);
    await expect(pending).rejects.toThrow("navigation changed");
    expect(service.get(f.ctx, question.id).status).toBe("pending");
  } finally {
    f.cleanup();
  }
});

test("concurrent answer and cancellation accept exactly one mutation without losing ledger records", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    const question = await service.ask(f.ctx, { text: "First" });
    for (let i = 1; i < 20; i++) await service.ask(f.ctx, { text: "Question " + i });
    const outcomes = await Promise.allSettled([
      service.answer(f.ctx, { id: question.id, owner: question.owner, version: question.version, text: "yes" }),
      service.cancel(f.ctx, { id: question.id, owner: question.owner, version: question.version }),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const reloaded = new QuestionService();
    expect(reloaded.list(f.ctx).length).toBe(20);
    const winner = outcomes.find((outcome) => outcome.status === "fulfilled")!;
    expect(reloaded.get(f.ctx, question.id).status).toBe(winner.value.status);
    expect(reloaded.get(f.ctx, question.id).version).toBe(question.version + 1);
  } finally {
    f.cleanup();
  }
});

test("pending and total ledger limits reject new questions without dropping saved history", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    const first = await service.ask(f.ctx, { text: "First" });
    for (let i = 1; i < 20; i++) await service.ask(f.ctx, { text: "Question " + i });
    await expect(service.ask(f.ctx, { text: "overflow" })).rejects.toThrow("Too many");
    await service.answer(f.ctx, { id: first.id, owner: first.owner, version: first.version, text: "yes" });
    const room = await service.ask(f.ctx, { text: "room" });
    await service.cancel(f.ctx, { id: room.id, owner: room.owner, version: room.version });
    for (let i = 0; i < 199; i++) {
      const question = await service.ask(f.ctx, { text: "terminal " + i });
      await service.cancel(f.ctx, { id: question.id, owner: question.owner, version: question.version });
    }
    await expect(service.ask(f.ctx, { text: "ledger full" })).rejects.toThrow("ledger full");
    const reloaded = new QuestionService();
    expect(reloaded.list(f.ctx).length).toBe(220);
    expect(reloaded.get(f.ctx, first.id).status).toBe("answered");
    expect(reloaded.get(f.ctx, first.id).answer).toBe("yes");
  } finally {
    f.cleanup();
  }
});

test("navigation to an ancestor is history only; deeper sibling forks cannot answer", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    const q = await s.ask(f.ctx, { text: "Original?" });
    f.move("first", "root");
    f.move("original-tip", "first");
    f.navigate("root");
    expect(s.get(f.ctx, q.id).readOnly).toBe(true);
    await expect(s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "wrong branch" })).rejects.toThrow(
      "owner branch",
    );
    await expect(s.ask(f.ctx, { text: "New?" })).rejects.toThrow("branch tip");
    f.move("deeper-fork", "first");
    expect(s.get(f.ctx, q.id).readOnly).toBe(true);
    await expect(s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "wrong fork" })).rejects.toThrow(
      "owner branch",
    );
    f.navigate("original-tip");
    expect(s.get(f.ctx, q.id).readOnly).toBe(false);
    await s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "original" });
  } finally {
    f.cleanup();
  }
});

// Execute journals append a diagnostic as an off-branch sibling before the toolResult.
test("execute diagnostic sibling does not steal question ownership from toolResult", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    f.move("assistant-tool-call", "root");
    const q = await service.ask(f.ctx, { text: "Choose", choices: ["A"], allowFreeText: false });
    const blocked = await service.block(f.ctx, {
      id: q.id,
      owner: q.owner,
      version: q.version,
      checkpoint: "Wait",
      foreground: true,
    });
    f.move("diagnostic", "assistant-tool-call", "custom", "bruv-diagnostic");
    f.move("tool-result", "assistant-tool-call", "message");
    f.move("assistant-waiting", "tool-result", "message");
    expect(service.get(f.ctx, q.id).readOnly).toBe(false);
    f.navigate("diagnostic");
    expect(service.get(f.ctx, q.id).readOnly).toBe(true);
    f.navigate("assistant-waiting");
    expect(service.get(f.ctx, q.id).readOnly).toBe(false);
    const answer = await service.answer(f.ctx, {
      id: q.id,
      owner: q.owner,
      version: blocked.version,
      text: "A",
      replyId: "reply-1",
    });
    expect(answer.replyId).toBe("reply-1");
    expect(
      await service.answer(f.ctx, {
        id: q.id,
        owner: q.owner,
        version: blocked.version,
        text: "A",
        replyId: "reply-1",
      }),
    ).toEqual(answer);
    f.move("real-fork", "assistant-tool-call", "message");
    expect(service.get(f.ctx, q.id).readOnly).toBe(true);
    await expect(
      service.answer(f.ctx, { id: q.id, owner: q.owner, version: answer.version, text: "A" }),
    ).rejects.toThrow("owner branch");
    f.navigate("root");
    expect(() => service.get(f.ctx, q.id)).toThrow("not found");
  } finally {
    f.cleanup();
  }
});

test("diagnostic-only child does not fork an owner at the root or tool anchor", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    const root = await service.ask(f.ctx, { text: "Root" });
    f.move("root-diagnostic", "root", "custom", "bruv-diagnostic");
    f.navigate("root");
    expect(service.get(f.ctx, root.id).readOnly).toBe(false);
    f.move("anchor", "root");
    const anchored = await service.ask(f.ctx, { text: "Anchor" });
    f.move("anchor-diagnostic", "anchor", "custom", "bruv-diagnostic");
    f.navigate("anchor");
    expect(service.get(f.ctx, anchored.id).readOnly).toBe(false);
    f.move("custom-fork", "anchor", "custom", "other-bookkeeping");
    f.navigate("anchor");
    expect(service.get(f.ctx, anchored.id).readOnly).toBe(true);
  } finally {
    f.cleanup();
  }
});

test("a real continuation through an inline diagnostic keeps ownership against a later sibling fork", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    f.move("anchor-inline", "root", "message");
    const q = await service.ask(f.ctx, { text: "Choose" });
    f.move("inline-diagnostic", "anchor-inline", "custom", "bruv-diagnostic");
    f.move("original-after-diagnostic", "inline-diagnostic", "message");
    expect(service.get(f.ctx, q.id).readOnly).toBe(false);
    f.move("later-fork", "anchor-inline", "message");
    expect(service.get(f.ctx, q.id).readOnly).toBe(true);
    await expect(
      service.answer(f.ctx, { id: q.id, owner: q.owner, version: q.version, text: "wrong fork" }),
    ).rejects.toThrow("owner branch");
    f.navigate("original-after-diagnostic");
    expect(service.get(f.ctx, q.id).readOnly).toBe(false);
    await service.answer(f.ctx, { id: q.id, owner: q.owner, version: q.version, text: "original" });
  } finally {
    f.cleanup();
  }
});

test("diagnostic chains preserve ancestor and sibling ownership", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    f.move("anchor-chain", "root", "message");
    const q = await s.ask(f.ctx, { text: "Choose" });
    f.move("d1", "anchor-chain", "custom", "bruv-diagnostic");
    f.move("d2", "d1", "custom", "bruv-diagnostic");
    f.move("original-chain", "d2", "message");
    f.navigate("anchor-chain");
    expect(s.get(f.ctx, q.id).readOnly).toBe(true);
    f.navigate("d1");
    expect(s.get(f.ctx, q.id).readOnly).toBe(true);
    f.move("fork-under-diagnostic", "d1", "message");
    expect(s.get(f.ctx, q.id).readOnly).toBe(true);
    f.navigate("original-chain");
    expect(s.get(f.ctx, q.id).readOnly).toBe(false);
  } finally {
    f.cleanup();
  }
});
test("a question anchored on a diagnostic still has a distinct owner", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    f.move("diagnostic-owner", "root", "custom", "bruv-diagnostic");
    const q = await s.ask(f.ctx, { text: "Diagnostic leaf" });
    f.move("owned-child", "diagnostic-owner", "message");
    expect(s.get(f.ctx, q.id).readOnly).toBe(false);
    f.move("other-child", "diagnostic-owner", "message");
    expect(s.get(f.ctx, q.id).readOnly).toBe(true);
    f.navigate("owned-child");
    await s.answer(f.ctx, { id: q.id, owner: q.owner, version: q.version, text: "yes" });
  } finally {
    f.cleanup();
  }
});

test("asking after diagnostic-only children keeps the conversation anchor, not a historical descendant", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    f.move("diagnostic", "root", "custom", "bruv-diagnostic");
    f.move("diagnostic-chain", "diagnostic", "custom", "bruv-diagnostic");
    f.navigate("root");
    const question = await service.ask(f.ctx, { text: "Human choice?" });
    expect(question.owner.branchId).toBe("root");
    expect(question.status).toBe("pending");
    expect(service.get(f.ctx, question.id).readOnly).toBe(false);
    f.move("real-child", "diagnostic-chain", "message");
    f.navigate("root");
    await expect(service.ask(f.ctx, { text: "History cannot ask" })).rejects.toThrow("current branch tip");
    expect(service.get(f.ctx, question.id).readOnly).toBe(true);
  } finally {
    f.cleanup();
  }
});

test("ask revalidates the conversation tip after waiting for the question ledger lock", async () => {
  const f = fixture();
  try {
    const service = new QuestionService();
    const lock = f.file + ".questions.json.lock";
    writeFileSync(lock, "busy");
    const pending = service.ask(f.ctx, { text: "Do not save after a continuation" });
    f.move("real-child", "root", "message");
    f.navigate("root");
    unlinkSync(lock);
    await expect(pending).rejects.toThrow("current branch tip");
    expect(service.list(f.ctx)).toEqual([]);
  } finally {
    f.cleanup();
  }
});
