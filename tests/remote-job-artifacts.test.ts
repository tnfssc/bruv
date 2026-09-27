import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureNativeJobText } from "../src/remote/job-artifacts";
test("native job text is paged into task-owned offline artifacts before buffers disappear", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-job-text-"));
  try {
    const text = "native text\n".repeat(1000),
      offsets: number[] = [];
    const host = {
      inspect: async (_id: string, offset = 0) => {
        offsets.push(offset);
        const output = text.slice(offset, offset + 5000);
        return {
          output,
          nextOffset: offset + output.length,
          hasMore: offset + output.length < text.length,
          baseOffset: 0,
        };
      },
    };
    expect(
      await captureNativeJobText(host as any, join(dir, "runtime.json"), [{ id: "task_output", status: "completed" }]),
    ).toBeUndefined();
    expect(offsets).toEqual([0, 5000, 10000]);
    expect(readFileSync(join(dir, "session.jsonl.artifacts", "execute-job-task_output", "stdout.log"), "utf8")).toBe(
      text,
    );
    expect(
      await captureNativeJobText(
        { inspect: async () => ({ output: "tail", baseOffset: 100, outputLost: true, hasMore: false }) } as any,
        join(dir, "runtime.json"),
        [{ id: "task_gap", status: "completed" }],
      ),
    ).toContain("retention gap");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
