import { expect, test } from "bun:test";
import { GfmBlockTokenizer, Markdown, Marked, visibleWidth } from "@earendil-works/pi-tui";
import { Lexer } from "marked";

const fast = (options = {}) => new Marked({ ...options, tokenizer: new GfmBlockTokenizer() });
const reference = (options = {}) => new Marked(options);
const lines = [
  "a",
  "abc  ",
  "=",
  "===",
  "- ",
  "---",
  "  --- ",
  "# hi",
  "> a",
  "    indent",
  "|---|",
  "a | b",
  "--- | ---",
  "\t",
  "  ",
  "",
  "\u2028",
  "a\r",
  "~~~",
  "* a",
  "1. a",
  "2. b",
  "<div>",
  "</div>",
  "[ref]: x",
  ":---",
  " x",
  "x  ",
  "\v",
];
test("line-bounded hooks preserve complete reference tokens and links", () => {
  const actual = fast(),
    expected = reference();
  // Exhaustive short heading/table/list/HTML/newline boundaries.
  for (const a of lines)
    for (const b of lines)
      for (const c of lines) {
        const source = `${a}\n${b}\n${c}`;
        expect(actual.lexer(source)).toEqual(expected.lexer(source));
      }
  for (const source of [
    "# Title\n\n**bold** _em_ ~~strike~~ [link](https://example.com)\n",
    "first\nsecond\n===\n\n> quote\n> continued\n",
    "header | next\n:--- | ---:\nfirst | second\nthird | fourth\n\nrest",
    "[link][ref]\n\n[ref]: https://example.com\n",
    "~~~mermaid\ngraph LR; A-->B\n~~~\n\n~~~js\nconsole.log(1)\n~~~\n",
    "👩‍👩‍👧‍👦 中 e\u0301 \x1b[31mred\x1b[0m\nplain\n",
    "word ".repeat(10000),
    "a".repeat(1 << 20),
    "deterministic pasted line\n".repeat(40000),
    // Preserve even Bun's original regex effort-limit result for huge headings.
    `${"deterministic pasted line\n".repeat(16000)}===`,
  ])
    expect(actual.lexer(source)).toEqual(expected.lexer(source));
});
test("non-GFM and pedantic parsers retain their original rules", () => {
  for (const options of [{ gfm: false }, { pedantic: true }])
    for (const a of lines)
      for (const b of lines) {
        const source = `${a}\n${b}`;
        expect(fast(options).lexer(source)).toEqual(reference(options).lexer(source));
      }
});
// Own the global regex hook for one lexer call, including assertion failures.
// Both callers forbid whole-block matchers and verify the complete raw token.
function measurePlainBlockWork(source: string) {
  const originalExec = RegExp.prototype.exec;
  const rules = Lexer.rules.block.gfm;
  const work = { calls: 0, units: 0, max: 0 };
  RegExp.prototype.exec = function (text: string) {
    expect(this.source).not.toBe(rules.lheading.source);
    expect(this.source).not.toBe(rules.paragraph.source);
    if (this.source.startsWith("^(?!")) {
      work.calls++;
      work.units += text.length;
      work.max = Math.max(work.max, text.length);
    }
    return originalExec.call(this, text);
  };
  try {
    expect(fast().lexer(source)[0].raw).toBe(source);
    return work;
  } finally {
    RegExp.prototype.exec = originalExec;
  }
}

test("plain block work is line-bounded and scales linearly", () => {
  const measurements: Array<{ calls: number; units: number; max: number }> = [];
  for (const n of [2000, 4000, 8000]) {
    const source = "deterministic pasted line\n".repeat(n);
    const work = measurePlainBlockWork(source);
    expect(work.calls).toBe(n - 1);
    expect(work.max).toBeLessThanOrEqual(52);
    expect(work.units).toBeLessThanOrEqual(source.length * 2);
    measurements.push(work);
  }
  for (let i = 1; i < measurements.length; i++) {
    expect(measurements[i].calls).toBe(measurements[i - 1].calls * 2 + 1);
    expect(measurements[i].units).toBeLessThanOrEqual(measurements[i - 1].units * 2 + 104);
  }
});
test("a megabyte single line avoids both whole-block matchers", () => {
  const work = measurePlainBlockWork("a".repeat(1 << 20));
  expect(work.calls).toBe(0);
});
test("short and long lines keep rich ANSI wrapping and complete text", () => {
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
    bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
    italic: identity,
    strikethrough: identity,
    underline: identity,
  };
  const source = `**bold** \x1b[31m${"a".repeat(4096)}\x1b[0m 中 e\u0301\nEND_VISIBLE`;
  const component = new Markdown(source, 0, 0, theme);
  const wide = component.render(80),
    narrow = component.render(31);
  expect(wide.join("\n")).toContain("\x1b[1mbold\x1b[22m");
  expect(narrow.join("\n")).toContain("END_VISIBLE");
  expect(
    narrow
      .join("")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Match terminal control bytes.
      .replace(/\x1b\[[0-9;]*m/g, "")
      .match(/a/g)?.length,
  ).toBe(4096);
  expect(narrow.every((line) => visibleWidth(line) <= 31)).toBe(true);
  expect(component.render(31)).toEqual(narrow);
});

test("exported block tokenizer preserves subclass hooks when Marked registers own properties", () => {
  let headings = 0,
    paragraphs = 0;
  class CustomTokenizer extends GfmBlockTokenizer {
    override lheading(source: string) {
      headings++;
      const token = super.lheading(source);
      return token ? { ...token, text: `custom ${token.text}` } : undefined;
    }
    override paragraph(source: string) {
      paragraphs++;
      const token = super.paragraph(source);
      return token ? { ...token, text: `custom ${token.text}` } : undefined;
    }
  }
  const tokenizer = new CustomTokenizer();
  expect(Object.hasOwn(tokenizer, "lheading")).toBe(true);
  expect(Object.hasOwn(tokenizer, "paragraph")).toBe(true);
  const tokens = new Marked({ tokenizer }).lexer("title\n---\n\nbody\n");
  expect(headings).toBeGreaterThan(0);
  expect(paragraphs).toBeGreaterThan(0);
  expect(tokens.some((token) => token.type === "heading" && token.text === "custom title")).toBe(true);
  expect(tokens.some((token) => token.type === "paragraph" && token.text === "custom body")).toBe(true);
});
