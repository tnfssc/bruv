import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { EditorPushToTalk, REPEAT_IDLE_MS } from "../src/live/editor-push-to-talk";

const press = "\x1b[32;1:1u";
const repeat = "\x1b[32;1:2u";
const release = "\x1b[32;1:3u";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture() {
  let now = 1000;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const changes: boolean[] = [];
  const hints: (string | undefined)[] = [];
  let text = "draft";
  const abort = new AbortController();
  const control = new EditorPushToTalk({
    signal: abort.signal,
    onTalking: (value) => changes.push(value),
    onHint: (value) => hints.push(value),
  });
  const input = (data: string, advance = 0) => {
    now += advance;
    return control.input(data, () => {
      const before = text;
      text += " ";
      const expected = text;
      return () => {
        if (text !== expected) return false;
        text = before;
        return true;
      };
    });
  };
  cleanups.push(() => {
    control.dispose();
    clock.mockRestore();
  });
  return {
    control,
    changes,
    hints,
    input,
    text: () => text,
    edit: (value: string) => {
      text = value;
    },
  };
}

describe("editor Space discriminator", () => {
  test("press alone never starts capture; release preserves its typed Space", async () => {
    const f = fixture();
    f.input(press);
    await Bun.sleep(REPEAT_IDLE_MS + 10);
    expect(f.changes).toEqual([false]);
    expect(f.text()).toBe("draft ");
    f.input(release);
    expect(f.text()).toBe("draft ");
  });

  test("explicit repeat removes warmup; modifier-changed release immediately mutes", () => {
    const f = fixture();
    f.input(press);
    f.input(repeat, 500);
    expect(f.text()).toBe("draft");
    expect(f.changes).toEqual([false, true]);
    f.input("\x1b[32;5:3u");
    expect(f.changes).toEqual([false, true, false]);
  });

  test("legacy rapid taps stay text; hold-length repeated packets activate", () => {
    const f = fixture();
    f.input(" ");
    f.input(" ", 50);
    f.input(" ", 50);
    expect(f.text()).toBe("draft   ");
    expect(f.changes).toEqual([false]);
    f.control.cancel();
    f.input(" ", 1500);
    f.input(" ", 500);
    f.input(" ", 30);
    expect(f.text()).toBe("draft   ");
    expect(f.changes).toEqual([false, true]);
  });

  test("slow intentional Spaces preceding a repeat run are not removed", () => {
    const f = fixture();
    f.input(" ");
    f.input(" ", 200);
    f.input(" ", 200);
    f.input(" ", 200);
    expect(f.text()).toBe("draft    ");
    f.input(" ", 500);
    f.input(" ", 30);
    expect(f.changes).toEqual([false, true]);
    expect(f.text()).toBe("draft   ");
  });

  test("legacy inactivity is a bounded inference, not an observed release", async () => {
    const f = fixture();
    f.input(" ");
    f.input(" ", 500);
    f.input(" ", 30);
    expect(f.changes.at(-1)).toBe(true);
    await Bun.sleep(REPEAT_IDLE_MS + 30);
    expect(f.changes.at(-1)).toBe(false);
  });

  test("changed draft cannot be rolled back or start the microphone", () => {
    const f = fixture();
    f.input(press);
    f.edit("replacement");
    f.input(repeat, 500);
    expect(f.text()).toBe("replacement");
    expect(f.changes).toEqual([false]);
  });

  test("focus loss closes and held repeats cannot restart on focus gain", () => {
    const f = fixture();
    f.input(press);
    f.input(repeat, 500);
    f.control.observeInput("\x1b[O");
    expect(f.changes.at(-1)).toBe(false);
    f.control.observeInput("\x1b[I");
    f.input(repeat, 30);
    expect(f.changes).toEqual([false, true, false]);
    f.input(press, 30);
    f.input(repeat, 500);
    expect(f.changes.at(-1)).toBe(true);
  });

  test("a repeat without a fresh press never starts", () => {
    const f = fixture();
    f.input(repeat);
    f.input(repeat, 30);
    expect(f.changes).toEqual([false]);
    expect(f.text()).toBe("draft");
  });

  test("paste chunks do not interpret their Space as voice", () => {
    const f = fixture();
    f.control.observeInput("\x1b[200~");
    expect(f.input(" ", 500)).toBe(false);
    expect(f.input(" ", 30)).toBe(false);
    f.control.observeInput("\x1b[201~");
    expect(f.changes).toEqual([false]);
  });
});
