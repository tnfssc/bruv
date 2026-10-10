import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createHash } from "node:crypto";
import {
  StdinBuffer,
  getKeybindings,
  setKeybindings,
  KeybindingsManager,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import type { KeybindingsManager as AppBindings } from "@earendil-works/pi-coding-agent";
import { CompactEditor } from "../../src/ui/editor";
import { BROWSER_INPUT_MARKER } from "../../src/live/browser-protocol";
import { createBrowserRequestInput } from "../../src/live/browser-request";
import { InputOwnership } from "../../src/web/input-ownership";
import { TerminalSession, type SocketData } from "../../src/web/terminal";

const terminals: TerminalSession[] = [];
afterEach(async () => {
  await Promise.all(terminals.splice(0).map((terminal) => terminal.stop()));
});
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(10);
  expect(check()).toBe(true);
}
async function fixture() {
  const claims: (string | undefined)[] = [];
  const messages: any[] = [];
  const ticket = "a".repeat(32);
  const terminal = new TerminalSession(
    [
      process.execPath,
      "-e",
      'process.stdin.setRawMode(true);console.log("READY");process.stdin.on("data",d=>console.log("BYTES",d.toString("hex")));setInterval(()=>{},1000)',
    ],
    process.cwd(),
    process.env,
    () => {},
    (owner) => {
      claims.push(owner);
      return ticket;
    },
  );
  terminals.push(terminal);
  const socket = (owner: string) =>
    ({
      data: { channel: "terminal", audioOwner: owner },
      readyState: 1,
      getBufferedAmount: () => 0,
      send: (text: string) => {
        messages.push(JSON.parse(text));
        return text.length;
      },
      close() {},
    }) as unknown as ServerWebSocket<SocketData>;
  const a = socket("private-a"),
    b = socket("private-b");
  terminal.attach(a);
  terminal.attach(b);
  const output = () =>
    messages
      .filter((m) => m.type === "output")
      .map((m) => Buffer.from(m.data, "base64").toString())
      .join("");
  await until(() => output().includes("READY"));
  return {
    terminal,
    a,
    b,
    claims,
    ticket,
    output,
    input: (socket: ServerWebSocket<SocketData>, data: string, encoding?: string) =>
      terminal.message(socket, JSON.stringify({ type: "input", data, encoding })),
  };
}

const authorKey = (owner: string) => createHash("sha256").update(owner).digest("hex").slice(0, 32);
const marker = (owner: string, ticket = "") => BROWSER_INPUT_MARKER + authorKey(owner) + ":" + ticket + "\x07";
function editorFixture() {
  const reader = createBrowserRequestInput();
  const editor = new CompactEditor(
    { requestRender() {} } as any,
    { borderColor: (s: string) => s } as any,
    { matches: () => false } as unknown as AppBindings,
  );
  const detach = reader.attach(editor);
  const stdin = new StdinBuffer();
  stdin.on("data", (data) => {
    if (!reader.observe(data)) editor.handleInput(data);
  });
  stdin.on("paste", (text) => {
    const data = "\x1b[200~" + text + "\x1b[201~";
    reader.observe(data);
    editor.handleInput(data);
  });
  const claims = new Map<string, string | undefined>();
  let n = 0;
  const input = new InputOwnership(
    (owner) => {
      const ticket = (++n).toString(16).padStart(32, "0");
      claims.set(ticket, owner);
      return ticket;
    },
    (bytes) => stdin.process(bytes),
  );
  const submissions: { text: string; owner?: string; ticket?: string }[] = [];
  editor.onSubmit = (text) => {
    const ticket = reader.take(editor);
    submissions.push({ text, owner: ticket ? claims.get(ticket) : undefined, ticket });
  };
  return {
    reader,
    editor,
    submissions,
    input: (owner: string, data: string) => input.input(Buffer.from(data), owner),
    close: () => {
      input.close();
      stdin.destroy();
      detach();
    },
  };
}

test("real editor continuation keeps both authors; one author can still submit /live", () => {
  const f = editorFixture();
  try {
    f.input("a", "/live\\\r");
    expect(f.editor.getText()).toBe("/live\n");
    expect(f.submissions).toEqual([]);
    f.input("b", "\r");
    expect(f.submissions[0]).toEqual({ text: "/live", owner: undefined, ticket: undefined });
    f.input("a", "/live\\\r");
    f.input("a", "\r");
    expect(f.submissions[1].owner).toBe("a");
    expect(f.reader.take(f.editor)).toBeUndefined();
  } finally {
    f.close();
  }
});

test("reports do not author commands; actual clear resets authorship", () => {
  const f = editorFixture();
  try {
    f.input("a", "/live");
    f.input("b", "\x1b[I\x1b[?1;2c\x1b]10;rgb:ffff/ffff/ffff\x1b\\");
    f.input("a", "\r");
    expect(f.submissions[0].owner).toBe("a");
    f.input("a", "/li");
    f.input("b", "ve");
    f.input("a", "\r");
    expect(f.submissions[1].ticket).toBeUndefined();
    f.input("a", "old");
    f.editor.setText("");
    f.input("b", "/live\r");
    expect(f.submissions[2].owner).toBe("b");
    f.input("a", "/status\r/live\r");
    expect(f.submissions.at(-1)?.owner).toBe("a");
  } finally {
    f.close();
  }
});

test("configured submit keys use the same real editor boundary", () => {
  const previous = getKeybindings();
  setKeybindings(
    new KeybindingsManager(TUI_KEYBINDINGS, { "tui.input.submit": "ctrl+s", "tui.input.newLine": "enter" }),
  );
  const f = editorFixture();
  try {
    f.input("a", "/live\r");
    expect(f.submissions).toEqual([]);
    f.input("b", "\x13");
    expect(f.submissions[0].ticket).toBeUndefined();
    f.input("a", "/live\r");
    f.input("a", "\x13");
    expect(f.submissions[1].owner).toBe("a");
  } finally {
    f.close();
    setKeybindings(previous);
  }
});

test("paste line breaks are not submits; UTF8 and binary bytes reach PTY unchanged", async () => {
  const f = await fixture();
  const paste = "\x1b[200~one\rtwo\nthree\x1b[201~";
  f.input(f.a, paste);
  expect(f.claims).toEqual([]);
  f.input(f.a, "\r");
  expect(f.claims).toEqual(["private-a"]);
  f.input(f.a, "你好");
  const binary = Buffer.from([0xff, 0xfe, 0x80]);
  f.input(f.a, binary.toString("base64"), "base64");
  await until(
    () => f.output().includes(Buffer.from("你好").toString("hex")) && f.output().includes(binary.toString("hex")),
  );
});

test("command captures its ticket before later dialog input and never renders markers", () => {
  const f = editorFixture();
  try {
    f.input("a", "/live\r");
    const submitted = f.submissions[0].ticket;
    expect(submitted).toBeDefined();
    expect(f.editor.getText()).toBe("");
    f.reader.observe(marker("b", "b".repeat(32)));
    expect(f.reader.take(f.editor)).toBeUndefined();
    expect(f.submissions[0].ticket).toBe(submitted);
  } finally {
    f.close();
  }
});

test("split escape and paste frames keep their original bytes and authorship", () => {
  const writes: Buffer[] = [],
    claims: (string | undefined)[] = [];
  const ticket = "c".repeat(32);
  const input = new InputOwnership(
    (owner) => {
      claims.push(owner);
      return ticket;
    },
    (bytes) => writes.push(bytes),
  );
  input.input(Buffer.from("\x1b[20"), "a");
  input.input(Buffer.from("0~one\rtwo"), "a");
  input.input(Buffer.from("\x1b[20"), "a");
  input.input(Buffer.from("1~"), "a");
  expect(claims).toEqual([]);
  expect(Buffer.concat(writes).toString()).toBe(marker("a") + "\x1b[200~one\rtwo\x1b[201~" + marker("a"));
  writes.length = 0;
  input.input(Buffer.from("\x1b"), "a");
  input.input(Buffer.from("\r"), "b");
  expect(claims).toEqual([undefined]);
  expect(Buffer.concat(writes).toString()).toBe(BROWSER_INPUT_MARKER + "-:" + ticket + "\x07\x1b\r");
  input.close();
});

test("real editor split paste carries all authors without putting private labels in the text", () => {
  const f = editorFixture();
  try {
    f.input("a", "\x1b[20");
    f.input("a", "0~/li");
    f.input("b", "ve\x1b[201~");
    expect(f.editor.getText()).toBe("/live");
    expect(f.submissions).toEqual([]);
    f.input("b", "\r");
    expect(f.submissions[0].ticket).toBeUndefined();
    f.input("a", "\x1b[200~/live\n\x1b[201~");
    expect(f.editor.getText()).toBe("/live\n");
    expect(f.submissions).toHaveLength(1);
    f.input("a", "\r");
    expect(f.submissions[1].owner).toBe("a");
  } finally {
    f.close();
  }
});

test("SDK-style clear then submit keeps its request, but later callbacks and teardown stay native", () => {
  const reader = createBrowserRequestInput();
  const editor = new CompactEditor(
    { requestRender() {} } as any,
    { borderColor: (s: string) => s } as any,
    { matches: () => false } as unknown as AppBindings,
  );
  const nativeInput = editor.handleInput;
  const nativeSetText = editor.setText;
  const detach = reader.attach(editor);
  const ticket = "a".repeat(32);
  reader.observe(marker("a", ticket));
  editor.setText("/live");
  // Pi's app-level follow-up shortcut clears before it calls onSubmit.
  editor.onExtensionShortcut = () => {
    editor.setText("");
    editor.onSubmit?.("/live");
    return true;
  };
  let captured: string | undefined;
  editor.onSubmit = () => {
    captured = reader.take(editor);
  };
  editor.handleInput("test-shortcut");
  expect(captured).toBe(ticket);
  const replacement = () => {};
  editor.onSubmit = replacement;
  detach();
  expect(editor.onSubmit).toBe(replacement);
  expect(editor.handleInput).toBe(nativeInput);
  expect(editor.setText).toBe(nativeSetText);
});

test("replaced editors cannot use a stale submitted ticket", () => {
  const f = editorFixture();
  try {
    const replacement = new CompactEditor(
      { requestRender() {} } as any,
      { borderColor: (s: string) => s } as any,
      { matches: () => false } as unknown as AppBindings,
    );
    f.editor.onSubmit = () => {};
    f.input("a", "/status\r");
    expect(f.reader.take(replacement)).toBeUndefined();
    expect(f.reader.take(f.editor)).toBeUndefined();
  } finally {
    f.close();
  }
});

test("submit callbacks still compose without recursion or losing the captured ticket", () => {
  const f = editorFixture();
  try {
    let calls = 0;
    const previous = f.editor.onSubmit;
    f.editor.onSubmit = (text) => {
      if (++calls > 2) throw new Error("submit callback cycle");
      previous?.(text);
    };
    f.input("a", "/live\r");
    expect(calls).toBe(1);
    expect(f.submissions).toHaveLength(1);
    expect(f.submissions[0].owner).toBe("a");
    expect(f.submissions[0].ticket).toMatch(/^[a-f0-9]{32}$/);
  } finally {
    f.close();
  }
});
