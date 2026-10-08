import { describe, expect, test } from "bun:test";
import { createHistoryFixture, runHistoryFixture } from "./helpers/history-fixture";

async function run(adapted: boolean) {
  const fixture = createHistoryFixture(adapted ? "bruv-history-parity-adapted-" : "bruv-history-parity-native-");
  const { stdout, stderr, code } = await runHistoryFixture("history-projection-parity.ts", fixture, {
    USE_DISK_HISTORY: adapted ? "1" : "0",
  });
  if (code !== 0) throw new Error(`scenario failed (${code}): ${stderr}`);
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}

describe("Pi 1.0.0 disk-backed session projection compatibility", () => {
  test("matches the real SDK for context edits and compaction system checkpoints", async () => {
    const [native, adapted] = await Promise.all([run(false), run(true)]);
    expect(adapted).toEqual(native);

    // Message edits and the first system checkpoint.
    const { checkpoint, branchEdits } = adapted;
    expect(checkpoint.edited.messages.map((message: { content: unknown }) => message.content)).toContain("edited user");
    expect(JSON.stringify(checkpoint.edited.messages)).toContain("edited assistant");
    expect(checkpoint.compaction).toEqual({ selfKept: true, systemContent: "system-v1" });
    expect(checkpoint.compacted.messages[0]).toEqual({ role: "system", content: "system-v1" });
    expect(JSON.stringify(checkpoint.compacted.messages)).not.toContain("original user");
    expect(checkpoint.context).toEqual(checkpoint.compacted.messages);
    expect(checkpoint.idsPresent).toBe(true);

    // Replacement persistence, edit validation and the branch before those edits.
    expect(branchEdits.reopenedProjection).toEqual(branchEdits.replacements);
    expect(branchEdits.originalsIntact).toBe(true);
    expect(branchEdits.rejects).toEqual({ systemMessage: true, missingEntry: true, inactiveEdit: true });
    expect(JSON.stringify(branchEdits.replacements.messages)).toContain("custom replacement");
    expect(JSON.stringify(branchEdits.replacements.messages)).toContain("tool replacement");
    expect(branchEdits.replacements.messages.some((message: { role: string }) => message.role === "assistant")).toBe(
      false,
    );
    expect(JSON.stringify(branchEdits.branchWithoutEdits.messages)).toContain("custom original");
    expect(JSON.stringify(branchEdits.branchWithoutEdits.messages)).not.toContain("replacement");

    // Repeated checkpoints preserve settings but not the earlier summary.
    expect(branchEdits.repeatedCompaction.thinkingLevel).toBe("high");
    expect(branchEdits.repeatedCompaction.model).toEqual({ provider: "fixture", modelId: "updated-model" });
    expect(JSON.stringify(branchEdits.repeatedCompaction.messages)).not.toContain("first checkpoint");
  }, 30_000);
});
