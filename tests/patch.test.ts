import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { applyPatch, parsePatch, patchPaths, registerPatch } from "../src/patch";
import { sdk } from "./sdk";

mkdirSync(".tmp", { recursive: true });
const root = mkdtempSync(resolve(".tmp/patch-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let count = 0;
function folder(files: Record<string, string>) {
  const dir = join(root, String(++count));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const read = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");
const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");

test("adds, updates, deletes and moves files in one patch", async () => {
  const dir = folder({ "a.txt": "one\ntwo\nthree\n", "old.txt": "gone\n", "src/b.txt": "keep\nchange\n" });
  const result = await applyPatch(
    patch(
      "*** Add File: new/c.txt",
      "+hello",
      "+world",
      "*** Update File: a.txt",
      "@@",
      " one",
      "-two",
      "+2",
      " three",
      "*** Delete File: old.txt",
      "*** Update File: src/b.txt",
      "*** Move to: dest/b.txt",
      "@@",
      " keep",
      "-change",
      "+changed",
    ),
    dir,
  );
  expect(result).toEqual({
    added: ["new/c.txt"],
    modified: ["a.txt"],
    deleted: ["old.txt"],
    moved: [{ from: "src/b.txt", to: "dest/b.txt" }],
  });
  expect(read(dir, "new/c.txt")).toBe("hello\nworld\n");
  expect(read(dir, "a.txt")).toBe("one\n2\nthree\n");
  expect(read(dir, "dest/b.txt")).toBe("keep\nchanged\n");
  expect(existsSync(join(dir, "old.txt"))).toBe(false);
  expect(existsSync(join(dir, "src/b.txt"))).toBe(false);
});

test("applies several chunks in order, using @@ lines to find the right place", async () => {
  const dir = folder({ "a.ts": "function a() {\n  return 1;\n}\nfunction b() {\n  return 1;\n}\n" });
  await applyPatch(
    patch(
      "*** Update File: a.ts",
      "@@ function a() {",
      "-  return 1;",
      "+  return 2;",
      "@@ function b() {",
      "-  return 1;",
      "+  return 3;",
    ),
    dir,
  );
  expect(read(dir, "a.ts")).toBe("function a() {\n  return 2;\n}\nfunction b() {\n  return 3;\n}\n");
});

test("matches lines that differ only in spacing or Unicode punctuation", async () => {
  const dir = folder({ "a.txt": "  indented   \nsay “hi” — now ok\nend\n" });
  await applyPatch(patch("*** Update File: a.txt", "@@", "-indented", '-say "hi" - now ok', "+fixed", " end"), dir);
  expect(read(dir, "a.txt")).toBe("fixed\nend\n");
});

test("an end-of-file chunk matches the last lines, not an earlier copy", async () => {
  const dir = folder({ "a.txt": "x\ny\nmiddle\nx\ny\n" });
  await applyPatch(patch("*** Update File: a.txt", "@@", " x", "-y", "+z", "*** End of File"), dir);
  expect(read(dir, "a.txt")).toBe("x\ny\nmiddle\nx\nz\n");
});

test("keeps a missing final newline, CRLF endings and a BOM", async () => {
  const dir = folder({ "a.txt": "a\nb", "b.txt": "﻿a\r\nb\r\n" });
  await applyPatch(
    patch("*** Update File: a.txt", "@@", " a", "-b", "+c", "*** Update File: b.txt", "@@", "-a", "+A", " b"),
    dir,
  );
  expect(read(dir, "a.txt")).toBe("a\nc");
  expect(read(dir, "b.txt")).toBe("﻿A\r\nb\r\n");
});

test("a chunk with only added lines goes after its @@ line", async () => {
  const dir = folder({ "a.txt": "first\nsecond\n" });
  await applyPatch(
    patch("*** Update File: a.txt", "@@ first", "+inserted", "*** Update File: a.txt", "@@", "+last"),
    dir,
  );
  expect(read(dir, "a.txt")).toBe("first\ninserted\nsecond\nlast\n");
});

test("a failing hunk changes no files and names the file and the missing lines", async () => {
  const dir = folder({ "a.txt": "one\n", "b.txt": "two\n", "c.txt": "three\n" });
  const run = applyPatch(
    patch(
      "*** Update File: a.txt",
      "@@",
      "-one",
      "+1",
      "*** Delete File: c.txt",
      "*** Add File: d.txt",
      "+new",
      "*** Update File: b.txt",
      "@@",
      "-missing-line-417",
      "+2",
    ),
    dir,
  );
  const error = await run.then(
    () => undefined,
    (e: Error) => e,
  );
  expect(error?.message).toContain("b.txt");
  expect(error?.message).toContain("missing-line-417");
  expect(read(dir, "a.txt")).toBe("one\n");
  expect(read(dir, "c.txt")).toBe("three\n");
  expect(existsSync(join(dir, "d.txt"))).toBe(false);
});

test("rejects malformed patches and missing files without writing", async () => {
  const dir = folder({ "a.txt": "one\n" });
  for (const input of [
    "*** Update File: a.txt\n@@\n-one\n+1",
    patch("*** Update File: a.txt"),
    patch("*** Change File: a.txt"),
    patch("*** Update File: a.txt", "@@", "-one", "+1", "@@", "?bad"),
    patch("*** Delete File: nope.txt"),
    patch("*** Update File: a.txt", "*** Move to: b.txt", "@@", "-two", "+1"),
  ])
    await expect(applyPatch(input, dir)).rejects.toThrow();
  expect(read(dir, "a.txt")).toBe("one\n");
  expect(existsSync(join(dir, "b.txt"))).toBe(false);
});

test("accepts a heredoc wrapper and a unified diff @@ header", () => {
  const body = patch("*** Update File: a.txt", "@@ -1,2 +1,2 @@", "-a", "+b");
  const [hunk] = parsePatch(`<<'EOF'\n${body}\nEOF\n`);
  expect(hunk).toEqual({
    type: "update",
    path: "a.txt",
    moveTo: undefined,
    chunks: [{ old: ["a"], new: ["b"], eof: false }],
  });
  expect(patchPaths(body)).toEqual(["a.txt"]);
});

test("scripts call apply_patch and get the changed files back", async () => {
  const dir = folder({ "a.txt": "one\n" });
  const app = await sdk([registerPatch], undefined, dir);
  try {
    let output = "";
    app.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("codemode", {
          code: `const r = await tools.apply_patch({ input: String.raw\`${patch("*** Update File: a.txt", "@@", "-one", "+1")}\` });\nreturn r.modified;`,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        output = JSON.stringify(context.messages.filter((m) => m.role === "toolResult").at(-1));
        return fauxAssistantMessage("done");
      },
    ]);
    await app.session.prompt("go");
    expect(output).toContain("a.txt");
    expect(read(dir, "a.txt")).toBe("1\n");
  } finally {
    await app.close();
  }
});

test("OpenAI models call apply_patch directly as a freeform tool; other models use it from scripts", async () => {
  const dir = folder({ "a.txt": "one\n" });
  const app = await sdk([registerPatch], undefined, dir);
  try {
    expect(app.session.getActiveToolNames()).not.toContain("apply_patch");
    await app.session.setModel({ ...app.faux.getModel(), id: "codex-patch", api: "openai-codex-responses" });
    expect(app.session.getActiveToolNames()).toContain("apply_patch");
    const tool = app.session.extensionRunner.getAllRegisteredTools().find((t) => t.definition.name === "apply_patch");
    expect(tool?.definition.constrainedSampling).toMatchObject({ type: "grammar" });
    await app.session.setModel(app.faux.getModel());
    expect(app.session.getActiveToolNames()).not.toContain("apply_patch");
  } finally {
    await app.close();
  }
});
