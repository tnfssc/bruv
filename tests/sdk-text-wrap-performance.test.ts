import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Markdown, Text, visibleWidth, wrapTextWithAnsi, truncateToWidth } from "@earendil-works/pi-tui";

const sdk = dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-tui"));
let dir: string;
let reference: Pick<typeof import("@earendil-works/pi-tui"), "visibleWidth" | "wrapTextWithAnsi" | "truncateToWidth">;
let ReferenceText: typeof Text;
let ReferenceMarkdown: typeof Markdown;

// Reverse only our installed utility hunk: this is the real 1.0.3 implementation, not an invented oracle.
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "bruv-wrap-reference-"));
  await mkdir(join(dir, "dist"));
  await writeFile(join(dir, "dist/utils.js"), await readFile(join(sdk, "utils.js")));
  const patch = await readFile(join(import.meta.dir, "../patches/@earendil-works%2Fpi-tui@1.0.3.patch"), "utf8");
  const utility =
    "diff --git a/dist/utils.js b/dist/utils.js\n" +
    patch.split("diff --git a/dist/utils.js b/dist/utils.js\n")[1].split("diff --git ")[0];
  await writeFile(join(dir, "utility.patch"), utility);
  const applied = Bun.spawnSync(["git", "apply", "--reverse", "utility.patch"], { cwd: dir });
  expect(applied.exitCode).toBe(0);
  const require = createRequire(join(sdk, "utils.js"));
  async function moduleFile(file: string, isUtility = false) {
    const source = await readFile(join(sdk, file), "utf8");
    const original = isUtility ? await readFile(join(dir, "dist/utils.js"), "utf8") : source;
    const resolved = original.replace(/(from\s+|import\s*)(["'])([^"']+)\2/g, (_match, prefix, quote, specifier) => {
      const target = specifier.endsWith("/utils.js")
        ? join(dir, "dist/utils.js")
        : specifier.startsWith(".")
          ? join(dirname(join(sdk, file)), specifier)
          : require.resolve(specifier);
      return prefix + quote + pathToFileURL(target).href + quote;
    });
    const destination = isUtility ? join(dir, "dist/utils.js") : join(dir, file.replaceAll("/", "-"));
    await writeFile(destination, resolved);
    return import(pathToFileURL(destination).href);
  }
  reference = await moduleFile("utils.js", true);
  ReferenceText = (await moduleFile("components/text.js")).Text;
  ReferenceMarkdown = (await moduleFile("components/markdown.js")).Markdown;
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const fragments = [
  "",
  "a",
  "word  ",
  "abcdefghijk",
  "\t",
  "\n",
  "\r\n",
  "\r",
  "界",
  "🙂",
  "e\u0301",
  "👩‍👩‍👧‍👦",
  "🇺🇳",
  "1️⃣",
  "\u0301",
  "สวัสดี",
  "\u0e33",
  "\x07",
  "\x1b?",
  "\x1b[4;31m",
  "\x1b[24m",
  "\x1b[0m",
  "\x1b[48;2;1;2;3m",
  "\x1b]8;;https://example.test/🙂\x1b\\",
  "\x1b]8;;\x1b\\",
  "\x1b]8;;https://example.test\x07",
  "\x1b]133;A\x07",
  "\x1b_cursor\x1b\\",
  "\u200d",
  "\ud800",
  "\u00a0",
  "\u200b",
];
const corpus = [
  ...fragments,
  "\x1b[4;44m" + "longword".repeat(40) + "\x1b[0m",
  "\x1b]8;;https://example.test\x07" + "longword".repeat(40) + "\x1b]8;;\x07",
  "a".repeat(30) + "界e\u0301🙂" + "b".repeat(30),
  "x界🙂".repeat(512),
  "word ".repeat(100),
];
let seed = 37;
for (let i = 0; i < 200; i++) {
  let text = "";
  for (let j = 0; j < 12; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    text += fragments[seed % fragments.length];
  }
  corpus.push(text);
}

test("wrapping, width and truncation exactly match original Unicode/ANSI layout", () => {
  for (const text of corpus) {
    expect(visibleWidth(text)).toBe(reference.visibleWidth(text));
    for (const width of [0, 1, 2, 3, 7, 16, 80, 2.5]) {
      expect(wrapTextWithAnsi(text, width)).toEqual(reference.wrapTextWithAnsi(text, width));
      expect(truncateToWidth(text, width)).toBe(reference.truncateToWidth(text, width));
    }
  }
});

const identity = (s: string) => s;
const theme = {
  heading: identity,
  link: identity,
  linkUrl: identity,
  code: identity,
  codeBlock: identity,
  codeBlockBorder: identity,
  quote: identity,
  quoteBorder: identity,
  hr: identity,
  listBullet: identity,
  bold: (s: string) => "\x1b[1m" + s + "\x1b[22m",
  italic: identity,
  strikethrough: identity,
  underline: (s: string) => "\x1b[4m" + s + "\x1b[24m",
};

test("actual SDK Text and Markdown render full large content, tail/cache and resize identically", () => {
  const sources = [
    "deterministic pasted line\n".repeat(42000) + "LARGE_TEXT_END",
    "ascii".repeat(200000),
    "x界🙂".repeat(8192),
    "# Heading\n\n**bold** [link](https://example.test)\n\n> 界e\u0301🙂\n\n- item\n\n~~~js\nconst a = 1;\n~~~\n",
    ...corpus.slice(32, 38),
  ];
  for (const source of sources) {
    for (const kind of ["text", "markdown"]) {
      const actual = kind === "text" ? new Text(source, 1, 1) : new Markdown(source, 1, 1, theme);
      const original = kind === "text" ? new ReferenceText(source, 1, 1) : new ReferenceMarkdown(source, 1, 1, theme);
      for (const width of [100, 46]) {
        const rendered = actual.render(width);
        expect(rendered).toEqual(original.render(width));
        expect(actual.render(width)).toBe(rendered);
        actual.invalidate();
        original.invalidate();
        expect(actual.render(width)).toEqual(original.render(width));
      }
    }
  }
}, 60000);

function graphemeWork(render: () => unknown) {
  const segment = Intl.Segmenter.prototype.segment;
  const work = { calls: 0, units: 0, yields: 0 };
  Intl.Segmenter.prototype.segment = function (text: string) {
    work.calls++;
    work.units += text.length;
    const segments = segment.call(this, text);
    return {
      [Symbol.iterator]: function* () {
        for (const item of segments) {
          work.yields++;
          yield item;
        }
      },
    } as never;
  };
  try {
    render();
    return work;
  } finally {
    Intl.Segmenter.prototype.segment = segment;
  }
}

test("actual SDK ASCII long-word layout avoids segmentation rather than deferring it", () => {
  const source = "a".repeat(32768);
  const old = graphemeWork(() => new ReferenceText(source, 0, 0).render(80));
  const next = graphemeWork(() => new Text(source, 0, 0).render(80));
  expect(old.yields).toBeGreaterThanOrEqual(source.length);
  expect(next.yields).toBe(0);
});

test("Unicode wrap-fit checks stop early without caching partial widths", () => {
  const source = "UNIQUE_WRAP_WIDTH_" + "x界🙂".repeat(8192);
  const old = graphemeWork(() => reference.wrapTextWithAnsi(source, 100));
  const next = graphemeWork(() => wrapTextWithAnsi(source, 100));
  expect(next.yields).toBeLessThan(old.yields - 24000);
  expect(visibleWidth(source)).toBe(reference.visibleWidth(source));
  expect(visibleWidth(source)).toBe("UNIQUE_WRAP_WIDTH_".length + 8192 * 5);
});
