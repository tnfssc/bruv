import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const timestamp = 1700000000000;
const assistant = (text: string) => ({
  role: "assistant" as const,
  content: [{ type: "text" as const, text }],
  api: "anthropic-messages" as const,
  provider: "anthropic",
  model: "offline",
  stopReason: "stop" as const,
  usage,
  timestamp,
});

/** Deterministic on-disk SDK session with two leaves; actual adapter lazily materializes bodies. */
export function createNavigationHistory(size: number) {
  if (!Number.isInteger(size) || size < 1) throw new Error("size must be a positive integer");
  const root = mkdtempSync(join(tmpdir(), "bruv-navigation-"));
  const file = join(root, "history.jsonl");
  const entries: unknown[] = [
    { type: "session", version: 3, id: "offline-navigation", timestamp: new Date(timestamp).toISOString(), cwd: root },
  ];
  let parentId: string | null = null;
  for (let i = 0; i < size; i++) {
    for (const [suffix, message] of [
      ["u", { role: "user", content: "request " + i + " needle alpha", timestamp }],
      ["a", assistant("response " + i + " needle beta\nsecond line")],
    ] as const) {
      const id = suffix + i;
      entries.push({ type: "message", id, parentId, timestamp: new Date(timestamp).toISOString(), message });
      parentId = id;
    }
  }
  entries.push({
    type: "message",
    id: "alternate",
    parentId: "u0",
    timestamp: new Date(timestamp).toISOString(),
    message: assistant("alternate branch needle"),
  });
  const text = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(file, text);
  // cwd differs by run. Hash actual content excluding the intentionally temporary header cwd.
  return {
    root,
    file,
    primaryLeaf: "a" + (size - 1),
    alternateLeaf: "alternate",
    contentHash: hash(
      entries
        .slice(1)
        .map((e) => JSON.stringify(e))
        .join("\n"),
    ),
    bytes: Buffer.byteLength(text),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
