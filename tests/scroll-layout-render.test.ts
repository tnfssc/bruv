import { expect, test } from "bun:test";
import { HStack, ScrollView, VStack, TuiAltScreen, type Terminal, type Component } from "@earendil-works/pi-tui";
import { getLayoutBoxesAt, getScrollViewBox, renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";

function documentFixture() {
  const widths: number[] = [];
  let text = "abcdefghijklmnopqrstuvwx";
  const component: Component = {
    invalidate() {},
    render(width) {
      widths.push(width);
      return Array.from({ length: Math.ceil(text.length / width) }, (_, index) =>
        text.slice(index * width, (index + 1) * width),
      );
    },
  };
  return {
    component,
    widths,
    replace(next: string) {
      text = next;
      component.invalidate();
    },
  };
}

const footer: Component = { invalidate() {}, render: () => ["footer"] };

test("stack measurement and scroll layout render content once per frame and width", () => {
  const doc = documentFixture();
  const scroll = new ScrollView(doc.component, { follow: "end" });
  const root = new VStack([
    { component: scroll, grow: 1 },
    { component: footer, shrink: 0 },
  ]);
  const frame = () => renderLayoutFrame(root, 6, 3, () => {});
  const first = frame();
  expect(doc.widths).toEqual([6]);
  expect(first.lines).toEqual(["mnopqr", "stuvwx", "footer"]);
  const box = getScrollViewBox(first, scroll)!;
  expect(box.scrollContentLines).toEqual(["abcdef", "ghijkl", "mnopqr", "stuvwx"]);
  expect(box.children[0].lines).toBe(box.scrollContentLines);
  expect(getLayoutBoxesAt(first, 0, 0).map((entry) => entry.component)).toContain(doc.component);
  expect(scroll.viewportHeight).toBe(2);
  expect(scroll.scrollTop).toBe(2);

  // Even unchanged frames render again: the cache never survives renderLayoutFrame.
  frame();
  expect(doc.widths).toEqual([6, 6]);
  doc.replace("NEWabcdefghijklmnopqrstuvwx");
  const changed = frame();
  expect(doc.widths).toEqual([6, 6, 6]);
  expect(changed.lines).toEqual(["pqrstu", "vwx", "footer"]);
  expect(scroll.scrollTop).toBe(3);

  scroll.scrollTo(1, { disableFollow: true });
  doc.replace("NEWabcdefghijklmnopqrstuvwxAPPEND");
  const anchored = frame();
  expect(doc.widths).toEqual([6, 6, 6, 6]);
  expect(anchored.lines).toEqual(["defghi", "jklmno", "footer"]);
  expect(scroll.scrollTop).toBe(1);
  expect(scroll.isFollowingEnd).toBe(false);
  const resized = renderLayoutFrame(root, 8, 3, () => {});
  expect(doc.widths).toEqual([6, 6, 6, 6, 8]);
  expect(resized.lines).toEqual(["fghijklm", "nopqrstu", "footer"]);
  expect(scroll.scrollTop).toBe(1);
});

test("natural measurement retains wrapped height and scrollbar gutter at each width", () => {
  const doc = documentFixture();
  const scroll = new ScrollView(doc.component, { scrollbar: "always" });
  const stack = new VStack([scroll, footer]);
  const first = renderLayoutFrame(stack, 9, 20, () => {});
  expect(doc.widths).toEqual([8]);
  expect(first.root.rect.height).toBe(20);
  expect(getScrollViewBox(first, scroll)!.rect.height).toBe(3);
  expect(first.lines.slice(0, 4).map((line) => Bun.stripANSI(line).trimEnd())).toEqual([
    "abcdefgh┃",
    "ijklmnop┃",
    "qrstuvwx┃",
    "footer",
  ]);
  // Direct/regular render still works without a layout context and keeps the gutter.
  expect(scroll.render(9)).toEqual(["abcdefgh ", "ijklmnop ", "qrstuvwx "]);
  expect(doc.widths).toEqual([8, 8]);

  doc.widths.length = 0;
  const horizontal = new HStack([{ component: scroll }, { component: footer, basis: 6, shrink: 0 }]);
  const frame = renderLayoutFrame(horizontal, 12, 10, () => {});
  expect(doc.widths).toEqual([11, 5]);
  expect(getScrollViewBox(frame, scroll)!.children[0].lines).toEqual(["abcde", "fghij", "klmno", "pqrst", "uvwx"]);
});

// Drive real fullscreen input without a terminal emulator or the performance harness.
class InputTerminal implements Terminal {
  columns = 40;
  rows = 8;
  kittyProtocolActive = false;
  input: (data: string) => void = () => {};
  start(input: (data: string) => void) {
    this.input = input;
  }
  stop() {}
  async drainInput() {}
  write() {}
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
}

test("fullscreen selection and search read current content after changes and resize", async () => {
  const terminal = new InputTerminal();
  const doc = documentFixture();
  doc.replace("row marker alpha ".repeat(25));
  const scroll = new ScrollView(doc.component, { primary: true });
  const root = new VStack([
    { component: scroll, grow: 1 },
    { component: footer, shrink: 0 },
  ]);
  const copied: string[] = [];
  const tui = new TuiAltScreen(terminal, false, undefined, {
    copyOnSelect: false,
    copySelection: async (text) => {
      copied.push(text);
      return true;
    },
  });
  tui.setLayoutRoot(root);
  try {
    tui.start();
    tui.renderNow();
    terminal.input("\x1b[<0;1;1M");
    terminal.input("\x1b[<32;4;1M");
    terminal.input("\x1b[<0;4;1m");
    tui.renderNow();
    expect(tui.hasActiveSelection()).toBe(true);
    expect(await tui.copyActiveSelectionToClipboard()).toBe(true);
    expect(copied).toEqual(["row"]);
    doc.replace("NEW " + "row marker alpha ".repeat(25));
    tui.renderNow();
    expect(await tui.copyActiveSelectionToClipboard()).toBe(true);
    expect(copied).toEqual(["row", "NEW"]);

    terminal.input("\x1b[<0;1;8M");
    terminal.input("\x1b[<0;1;8m");
    terminal.input("\x1b[102;6u"); // Ctrl+Shift+F: transcript search.
    terminal.input("NEW");
    tui.renderNow();
    expect(tui.getScreenLines().some((line) => line.includes("\x1b[1;7mNEW"))).toBe(true);
    expect(tui.getScreenLines().map(Bun.stripANSI).join("\n")).toContain("1/1");
    terminal.columns = 32;
    tui.renderNow();
    expect(tui.getScreenLines().some((line) => line.includes("\x1b[1;7mNEW"))).toBe(true);
    doc.replace("OTHER " + "row marker alpha ".repeat(25));
    tui.renderNow();
    expect(tui.getScreenLines().map(Bun.stripANSI).join("\n")).toContain("No matches");
  } finally {
    tui.stop();
  }
});
