import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Markdown, Text, visibleWidth, wrapTextWithAnsi, truncateToWidth } from "@earendil-works/pi-tui";

type LayoutUtilities = Pick<
  typeof import("@earendil-works/pi-tui"),
  "visibleWidth" | "wrapTextWithAnsi" | "truncateToWidth"
>;

// Reverse only our installed utility hunk: this is the real 1.1.0 implementation, not an invented oracle.
// All writes and git apply belong to this retained fixture; installed dependencies stay read-only.
async function createOriginalSdkReference() {
  const sdk = dirname(createRequire(import.meta.url).resolve("@earendil-works/pi-tui"));
  const dir = await mkdtemp(join(tmpdir(), "bruv-wrap-reference-"));
  for (const child of ["dist", "home", "config", "agent", "tmp"]) await mkdir(join(dir, child));
  await writeFile(join(dir, "provenance.json"), JSON.stringify({ worktree: dirname(dirname(import.meta.dir)), sdk }));
  await writeFile(join(dir, "dist/utils.js"), await readFile(join(sdk, "utils.js")));
  const patch = await readFile(join(import.meta.dir, "../../patches/@earendil-works%2Fpi-tui@1.1.0.patch"), "utf8");
  const utility =
    "diff --git a/dist/utils.js b/dist/utils.js\n" +
    patch.split("diff --git a/dist/utils.js b/dist/utils.js\n")[1].split("diff --git ")[0];
  await writeFile(join(dir, "utility.patch"), utility);
  const applied = Bun.spawnSync(["git", "apply", "--reverse", "utility.patch"], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      HOME: join(dir, "home"),
      XDG_CONFIG_HOME: join(dir, "config"),
      BRUV_CODING_AGENT_DIR: join(dir, "agent"),
      PI_CODING_AGENT_DIR: join(dir, "agent"),
      TMPDIR: join(dir, "tmp"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(dir, "config/gitconfig"),
    },
  });
  expect(applied.exitCode).toBe(0);

  // Original Text/Markdown must share the reversed utility, while other imports
  // still resolve to installed SDK dependencies (including external packages).
  const require = createRequire(join(sdk, "utils.js"));
  async function loadModule(file: string) {
    const destination = file === "utils.js" ? join(dir, "dist/utils.js") : join(dir, file.replaceAll("/", "-"));
    const source = await readFile(file === "utils.js" ? destination : join(sdk, file), "utf8");
    const resolved = source.replace(/(from\s+|import\s*)(["'])([^"']+)\2/g, (_match, prefix, quote, specifier) => {
      const target = specifier.endsWith("/utils.js")
        ? join(dir, "dist/utils.js")
        : specifier.startsWith(".")
          ? join(dirname(join(sdk, file)), specifier)
          : require.resolve(specifier);
      return prefix + quote + pathToFileURL(target).href + quote;
    });
    await writeFile(destination, resolved);
    return import(pathToFileURL(destination).href);
  }
  return {
    utils: (await loadModule("utils.js")) as LayoutUtilities,
    Text: (await loadModule("components/text.js")).Text as typeof Text,
    Markdown: (await loadModule("components/markdown.js")).Markdown as typeof Markdown,
  };
}

let original: Awaited<ReturnType<typeof createOriginalSdkReference>>;
beforeAll(async () => {
  original = await createOriginalSdkReference();
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
    expect(visibleWidth(text)).toBe(original.utils.visibleWidth(text));
    for (const width of [0, 1, 2, 3, 7, 16, 80, 2.5]) {
      expect(wrapTextWithAnsi(text, width)).toEqual(original.utils.wrapTextWithAnsi(text, width));
      expect(truncateToWidth(text, width)).toBe(original.utils.truncateToWidth(text, width));
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
      const reference = kind === "text" ? new original.Text(source, 1, 1) : new original.Markdown(source, 1, 1, theme);
      for (const width of [100, 46]) {
        const rendered = actual.render(width);
        expect(rendered).toEqual(reference.render(width));
        expect(actual.render(width)).toBe(rendered);
        actual.invalidate();
        reference.invalidate();
        expect(actual.render(width)).toEqual(reference.render(width));
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
  const old = graphemeWork(() => new original.Text(source, 0, 0).render(80));
  const next = graphemeWork(() => new Text(source, 0, 0).render(80));
  expect(old.yields).toBeGreaterThanOrEqual(source.length);
  expect(next.yields).toBe(0);
});

test("Unicode wrap-fit checks stop early without caching partial widths", () => {
  const source = "UNIQUE_WRAP_WIDTH_" + "x界🙂".repeat(8192);
  const old = graphemeWork(() => original.utils.wrapTextWithAnsi(source, 100));
  const next = graphemeWork(() => wrapTextWithAnsi(source, 100));
  expect(next.yields).toBeLessThan(old.yields - 24000);
  expect(visibleWidth(source)).toBe(original.utils.visibleWidth(source));
  expect(visibleWidth(source)).toBe("UNIQUE_WRAP_WIDTH_".length + 8192 * 5);
});
