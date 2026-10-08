import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    expect(readFileSync(artifactPath(dir, "task_output"), "utf8")).toBe(text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function artifactPath(dir: string, id: string): string {
  return join(dir, "session.jsonl.artifacts", "execute-job-" + id, "stdout.log");
}

test.each([
  ["outputLost", { outputLost: true }],
  ["baseOffset ahead of the requested cursor", { baseOffset: 100 }],
] as const)("retention via %s publishes the retained tail without an incomplete marker", async (_signal, metadata) => {
  const dir = mkdtempSync(join(tmpdir(), "remote-job-text-retention-"));
  const offsets: number[] = [];
  try {
    const host = {
      inspect: async (_id: string, offset: number) => {
        offsets.push(offset);
        return { output: "retained tail", hasMore: false, ...metadata };
      },
    };
    expect(await captureNativeJobText(host, join(dir, "runtime.json"), [{ id: "retained", status: "completed" }])).toBe(
      "Native job output retention gap: retained",
    );
    expect(offsets).toEqual([0]);
    expect(readFileSync(artifactPath(dir, "retained"), "utf8")).toBe("retained tail");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only safe terminal jobs are captured in list order; later success retains the last gap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-job-text-order-"));
  const inspected: string[] = [];
  try {
    const host = {
      inspect: async (id: string) => {
        if (inspected.length) expect(existsSync(artifactPath(dir, inspected.at(-1)!))).toBe(true);
        inspected.push(id);
        return { output: id, outputLost: id === "cancelled" || id === "stopped" };
      },
    };
    const jobs = [
      { status: "completed" },
      { id: "../escape", status: "completed" },
      { id: "x".repeat(101), status: "completed" },
      { id: "active", status: "running" },
      ...["completed", "failed", "cancelled", "stopped", "killed"].map((status) => ({ id: status, status })),
    ];
    expect(await captureNativeJobText(host as any, join(dir, "runtime.json"), jobs)).toBe(
      "Native job output retention gap: stopped",
    );
    expect(inspected).toEqual(["completed", "failed", "cancelled", "stopped", "killed"]);
    for (const id of inspected) {
      expect(readFileSync(artifactPath(dir, id), "utf8")).toBe(id);
      expect(statSync(artifactPath(dir, id)).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "session.jsonl.artifacts", "execute-job-" + id)).mode & 0o777).toBe(0o700);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inspection failure replaces prior text with captured prefix and an exact incomplete marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-job-text-error-"));
  const path = artifactPath(dir, "partial");
  mkdirSync(join(dir, "session.jsonl.artifacts", "execute-job-partial"), { recursive: true });
  writeFileSync(path, "prior snapshot");
  const offsets: number[] = [];
  const gap = "Native job text capture incomplete for partial: Error: inspect unavailable";
  try {
    const host = {
      inspect: async (id: string, offset: number) => {
        if (id === "next") {
          expect(readFileSync(path, "utf8")).toBe("prefix\n[" + gap + "]\n");
          return { output: "next job" };
        }
        offsets.push(offset);
        expect(readFileSync(path, "utf8")).toBe("prior snapshot");
        if (offset === 0) return { output: "prefix", nextOffset: 6, hasMore: true, outputLost: true };
        throw Error("inspect unavailable");
      },
    };
    expect(
      await captureNativeJobText(host as any, join(dir, "runtime.json"), [
        { id: "partial", status: "completed" },
        { id: "next", status: "failed" },
      ]),
    ).toBe(gap);
    expect(offsets).toEqual([0, 6]);
    expect(readFileSync(artifactPath(dir, "next"), "utf8")).toBe("next job");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nonadvancing output cursor preserves its page with a pagination gap marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-job-text-cursor-"));
  const offsets: number[] = [];
  const gap = "Native job text capture incomplete for cursor: Error: Native job output pagination gap";
  try {
    const host = {
      inspect: async (_id: string, offset: number) => {
        offsets.push(offset);
        return { output: "page", nextOffset: offset, hasMore: true };
      },
    };
    expect(
      await captureNativeJobText(host as any, join(dir, "runtime.json"), [{ id: "cursor", status: "completed" }]),
    ).toBe(gap);
    expect(offsets).toEqual([0]);
    expect(readFileSync(artifactPath(dir, "cursor"), "utf8")).toBe("page\n[" + gap + "]\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("page limit retains all 2200 pages before marking incomplete capture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-job-text-pages-"));
  let calls = 0;
  const gap = "Native job text capture incomplete for pages: Error: Native job output pagination gap";
  try {
    const host = {
      inspect: async (_id: string, offset: number) => {
        expect(offset).toBe(calls++);
        return { output: ".", nextOffset: offset + 1, hasMore: true };
      },
    };
    expect(
      await captureNativeJobText(host as any, join(dir, "runtime.json"), [{ id: "pages", status: "completed" }]),
    ).toBe(gap);
    expect(calls).toBe(2200);
    expect(readFileSync(artifactPath(dir, "pages"), "utf8")).toBe(".".repeat(2200) + "\n[" + gap + "]\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("10 MiB limit counts UTF-8 bytes and excludes the page that exceeds it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-job-text-bytes-"));
  const boundary = "é".repeat(5 * 1024 * 1024);
  const offsets: number[] = [];
  const gap = "Native job text capture incomplete for bytes: Error: Native job output exceeds 10 MiB artifact limit";
  try {
    const host = {
      inspect: async (_id: string, offset: number) => {
        offsets.push(offset);
        return offset === 0
          ? { output: boundary, nextOffset: boundary.length, hasMore: true }
          : { output: "é", hasMore: false };
      },
    };
    expect(
      await captureNativeJobText(host as any, join(dir, "runtime.json"), [{ id: "bytes", status: "completed" }]),
    ).toBe(gap);
    expect(offsets).toEqual([0, boundary.length]);
    expect(readFileSync(artifactPath(dir, "bytes"), "utf8")).toBe(boundary + "\n[" + gap + "]\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("staging-open failure preserves the prior artifact and rejects before capturing later jobs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-job-text-write-"));
  const path = artifactPath(dir, "blocked");
  mkdirSync(join(dir, "session.jsonl.artifacts", "execute-job-blocked"), { recursive: true });
  writeFileSync(path, "prior snapshot");
  mkdirSync(path + "." + process.pid);
  const inspected: string[] = [];
  try {
    const host = {
      inspect: async (id: string) => {
        inspected.push(id);
        return { output: "replacement" };
      },
    };
    await expect(
      captureNativeJobText(host as any, join(dir, "runtime.json"), [
        { id: "blocked", status: "completed" },
        { id: "next", status: "completed" },
      ]),
    ).rejects.toMatchObject({ code: "EISDIR" });
    expect(inspected).toEqual(["blocked"]);
    expect(readFileSync(path, "utf8")).toBe("prior snapshot");
    expect(existsSync(artifactPath(dir, "next"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
