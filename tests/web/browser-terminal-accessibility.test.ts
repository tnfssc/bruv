import { expect, test } from "bun:test";
import { Ghostty, type Terminal } from "ghostty-web";
import { visibleTerminalText } from "../../src/web/browser-terminal-accessibility";

const ghostty = await Ghostty.load(new URL("../../node_modules/ghostty-web/ghostty-vt.wasm", import.meta.url).pathname);

function viewport(cols = 24, rows = 2) {
  const screen = ghostty.createTerminal(cols, rows);
  screen.write("\x1b[2J\x1b[H");
  let offset = 0;
  const term = {
    cols,
    rows,
    wasmTerm: screen,
    buffer: {
      get active() {
        return { type: screen.isAlternateScreen() ? "alternate" : "normal" };
      },
    },
    getViewportY: () => offset,
  };
  return {
    screen,
    text: () => visibleTerminalText(term as Terminal),
    scroll: (lines: number) => {
      offset = lines;
    },
    resize(nextCols: number, nextRows: number) {
      screen.resize(nextCols, nextRows);
      term.cols = nextCols;
      term.rows = nextRows;
    },
  };
}

test("accessible text reads the real viewport, history and overwritten cells", () => {
  const v = viewport();
  try {
    v.screen.write("first\r\nsecond\r\nthird");
    expect(v.screen.getScrollbackLength()).toBe(1);
    expect(v.text()).toBe("second\nthird");
    v.scroll(1);
    expect(v.text()).toBe("first\nsecond");
    v.scroll(0);
    v.screen.write("\r\x1b[2Kreplaced");
    expect(v.text()).toBe("second\nreplaced");
    v.resize(24, 3);
    expect(v.text()).toBe("first\nsecond\nreplaced");
  } finally {
    v.screen.free();
  }
});

test("alternate output never reads normal history or its scroll offset", () => {
  const v = viewport();
  try {
    v.screen.write("history\r\nnormal one\r\nnormal two");
    v.scroll(1);
    v.screen.write("\x1b[?1049h\x1b[2J\x1b[Halt one\r\nalt two");
    expect(v.text()).toBe("alt one\nalt two");
    v.screen.write("\x1b[?1049l");
    expect(v.text()).toBe("history\nnormal one");
    v.scroll(0);
    expect(v.text()).toBe("normal one\nnormal two");
  } finally {
    v.screen.free();
  }
});

test("viewport text keeps graphemes once and omits invisible cell contents", () => {
  const v = viewport();
  try {
    v.screen.write("界e\u0301\x1b[8mhide\x1b[0m!");
    expect(v.text()).toBe("界e\u0301    !");
    v.screen.write("\r\nsecond\r\nthird");
    v.scroll(1);
    expect(v.text()).toBe("界e\u0301    !\nsecond");
    v.scroll(0);
    v.screen.write("\x1b[2J\x1b[Hfresh");
    expect(v.text()).toBe("fresh");
  } finally {
    v.screen.free();
  }
});
