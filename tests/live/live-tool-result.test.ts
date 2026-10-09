import { expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { voiceToolResult } from "../../src/live/tool-result";

// Artifact-writing scenarios own a fresh directory and retain it for inspection.

test("small results retain structured content and errors", async () => {
  const value = { content: [{ type: "text", text: "ok" }], isError: true };
  expect(await voiceToolResult(value)).toEqual({ output: value });
});

test("large and image-bearing results have a bounded wire preview and complete readable artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bruv-tool-result-test-"));
  const value = { content: [{ type: "image", data: "a".repeat(200_000), mimeType: "image/png" }] };
  const mapped = await voiceToolResult(value, directory);
  expect(mapped.truncated).toBe(true);
  expect((mapped.preview as string).length).toBeLessThanOrEqual(8192);
  expect(JSON.parse(await readFile(mapped.artifactPath as string, "utf8"))).toEqual({ output: value });
});

test("unserializable tool results report failure instead of fabricating success", async () => {
  const cyclic: any = {};
  cyclic.self = cyclic;
  expect(await voiceToolResult(cyclic)).toEqual({ error: "Could not serialize tool result." });
});

test("small image still identifies visual modality loss and retains data in artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bruv-tool-result-test-"));
  const value = { content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }] };
  const mapped = await voiceToolResult(value, directory);
  expect(mapped.imageNotVisuallyRendered).toBe(true);
  expect(mapped.note).toBe(
    "Full JSON result: artifactPath. Read with execute. Preview may end mid-value. Image bytes stay in the file; JSON output does not show images.",
  );
  expect(mapped.truncated).toBe(false);
  expect(JSON.parse(await readFile(mapped.artifactPath as string, "utf8"))).toEqual({ output: value });
});

test("null and missing results are explicit null outputs", async () => {
  expect(await voiceToolResult(null)).toEqual({ output: null });
  expect(await voiceToolResult(undefined)).toEqual({ output: null });
});

test("64 KiB includes the JSON envelope; larger results are saved privately under the session directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bruv-tool-result-test-"));
  const artifactDirectory = join(directory, "session.artifacts", "live");
  const value = "x".repeat(64 * 1024 - Buffer.byteLength(JSON.stringify({ output: "" })));
  expect(Buffer.byteLength(JSON.stringify({ output: value }))).toBe(64 * 1024);
  expect(await voiceToolResult(value, artifactDirectory)).toEqual({ output: value });

  const serialized = JSON.stringify({ output: value + "x" });
  const mapped = await voiceToolResult(value + "x", artifactDirectory);
  expect(mapped).toMatchObject({
    truncated: true,
    imageNotVisuallyRendered: false,
    bytes: 64 * 1024 + 1,
    preview: serialized.slice(0, 8192),
  });
  const path = mapped.artifactPath as string;
  expect(dirname(path).startsWith(join(artifactDirectory, "bruv-live-tool-"))).toBe(true);
  expect(await readFile(path, "utf8")).toBe(serialized);
  expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("inline limit counts UTF-8 bytes while the preview is a JSON character slice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bruv-tool-result-test-"));
  const value = { content: [{ type: "text", text: "é".repeat(40_000) }], isError: true };
  const serialized = JSON.stringify({ output: value });
  expect(serialized.length).toBeLessThan(64 * 1024);
  expect(Buffer.byteLength(serialized)).toBeGreaterThan(64 * 1024);
  const mapped = await voiceToolResult(value, directory);
  expect(mapped.bytes).toBe(Buffer.byteLength(serialized));
  expect(mapped.truncated).toBe(true);
  expect(mapped.preview).toBe(serialized.slice(0, 8192));
  expect(await readFile(mapped.artifactPath as string, "utf8")).toBe(serialized);
});

test("artifact storage failure returns an error, not a preview with an unreadable evidence path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bruv-tool-result-test-"));
  const blockedDirectory = join(directory, "not-a-directory");
  await writeFile(blockedDirectory, "file blocks artifact directory creation");
  const value = "x".repeat(64 * 1024);
  expect(await voiceToolResult(value, blockedDirectory)).toEqual({
    error: "Could not deliver or save tool result.",
    bytes: Buffer.byteLength(JSON.stringify({ output: value })),
  });
});
