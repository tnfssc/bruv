import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuestionService } from "../src/questions/service";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "die-questions-"));
  let leaf = "root";
  let entries: Array<{ id: string; parentId: string | null; type?: string; customType?: string }> = [
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
test("nonblocking, context, choices, explicit block and resolution survive reload", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    const q = await s.ask(f.ctx, {
      text: "Pick",
      choices: ["A", "B"],
      allowFreeText: false,
      requester: "analyst",
      taskIds: ["t1"],
      reason: "Need input",
      dedupKey: "k",
    });
    expect(q.blocked).toBeUndefined();
    expect(new QuestionService().get(f.ctx, q.id).requester).toBe("analyst");
    const b = await s.block(f.ctx, {
      id: q.id,
      owner: q.owner,
      version: q.version,
      checkpoint: "Await selection",
      foreground: true,
      taskIds: ["t1"],
    });
    expect(b.blocked?.checkpoint).toBe("Await selection");
    await expect(s.answer(f.ctx, { id: q.id, owner: q.owner, version: b.version, text: "wrong" })).rejects.toThrow(
      "choice",
    );
    const a = await s.answer(f.ctx, { id: q.id, owner: q.owner, version: b.version, text: "A", replyId: "ui-event-1" });
    expect(a.delivery).toBe("resume-needed");
    expect(a.replyId).toBe("ui-event-1");
    expect(
      await s.answer(f.ctx, { id: q.id, owner: q.owner, version: b.version, text: "A", replyId: "ui-event-1" }),
    ).toEqual(a);
    await expect(
      s.answer(f.ctx, { id: q.id, owner: q.owner, version: b.version, text: "B", replyId: "ui-event-1" }),
    ).rejects.toThrow("Stale");
    const delivered = await s.setDelivery(f.ctx, { id: q.id, owner: q.owner, version: a.version, delivery: "queued" });
    expect(new QuestionService().get(f.ctx, q.id).delivery).toBe("queued");
    expect(delivered.version).toBe(a.version + 1);
    expect(() => s.handle("questions.answer", { id: q.id }, f.ctx)).toThrow("UI reply only");
    const other = await s.ask(f.ctx, { text: "Optional", choices: ["Y"], allowFreeText: true });
    expect(
      (await s.resolve(f.ctx, { id: other.id, owner: other.owner, version: 1, reason: "No longer needed" }))
        .resolutionReason,
    ).toBe("No longer needed");
  } finally {
    f.cleanup();
  }
});
test("dedup after progress, sibling fork is read-only, navigation during lock wait", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    const q = await s.ask(f.ctx, { text: "What?", dedupKey: "request" });
    f.move("original", "root");
    f.move("progress", "original");
    expect((await s.ask(f.ctx, { text: "What?", dedupKey: "request" })).id).toBe(q.id);
    f.move("sibling", "root");
    expect(s.get(f.ctx, q.id).id).toBe(q.id);
    await expect(s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "no" })).rejects.toThrow("owner branch");
    expect((await s.ask(f.ctx, { text: "What?", dedupKey: "request" })).id).not.toBe(q.id);
    f.navigate("progress");
    const lock = f.file + ".questions.json.lock";
    writeFileSync(lock, "held");
    const pending = s.answer(f.ctx, { id: q.id, owner: q.owner, version: 1, text: "late" });
    await Bun.sleep(40);
    f.navigate("sibling");
    unlinkSync(lock);
    await expect(pending).rejects.toThrow("navigation changed");
    expect(s.get(f.ctx, q.id).status).toBe("pending");
  } finally {
    f.cleanup();
  }
});
test("bounded ledger and answer/cancel race without loss", async () => {
  const f = fixture();
  try {
    const s = new QuestionService();
    const first = await s.ask(f.ctx, { text: "First" });
    for (let i = 1; i < 20; i++) await s.ask(f.ctx, { text: "Question " + i });
    await expect(s.ask(f.ctx, { text: "overflow" })).rejects.toThrow("Too many");
    const outcomes = await Promise.allSettled([
      s.answer(f.ctx, { id: first.id, owner: first.owner, version: 1, text: "yes" }),
      s.cancel(f.ctx, { id: first.id, owner: first.owner, version: 1 }),
    ]);
    expect(outcomes.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(new QuestionService().list(f.ctx).length).toBe(20);
    const room = await s.ask(f.ctx, { text: "room" });
    await s.cancel(f.ctx, { id: room.id, owner: room.owner, version: 1 });
    for (let i = 0; i < 199; i++) {
      const q = await s.ask(f.ctx, { text: "terminal " + i });
      await s.cancel(f.ctx, { id: q.id, owner: q.owner, version: 1 });
    }
    await expect(s.ask(f.ctx, { text: "ledger full" })).rejects.toThrow("ledger full");
    expect(new QuestionService().list(f.ctx).length).toBe(220);
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
    f.move("diagnostic", "assistant-tool-call", "custom", "die-diagnostic");
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
    f.move("root-diagnostic", "root", "custom", "die-diagnostic");
    f.navigate("root");
    expect(service.get(f.ctx, root.id).readOnly).toBe(false);
    f.move("anchor", "root");
    const anchored = await service.ask(f.ctx, { text: "Anchor" });
    f.move("anchor-diagnostic", "anchor", "custom", "die-diagnostic");
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
    f.move("inline-diagnostic", "anchor-inline", "custom", "die-diagnostic");
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
    f.move("d1", "anchor-chain", "custom", "die-diagnostic");
    f.move("d2", "d1", "custom", "die-diagnostic");
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
    f.move("diagnostic-owner", "root", "custom", "die-diagnostic");
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
    f.move("diagnostic", "root", "custom", "die-diagnostic");
    f.move("diagnostic-chain", "diagnostic", "custom", "die-diagnostic");
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
