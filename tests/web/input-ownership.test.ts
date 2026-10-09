import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
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

test("submission binds all editors, not focus, resize, reports, or last writer", async () => {
  const f = await fixture();
  f.input(f.a, "/live");
  f.input(f.b, "\x1b[I");
  f.input(f.b, "\x1b[?1;2c");
  f.input(f.b, "\x1b]10;rgb:ffff/ffff/ffff\x1b\\");
  f.terminal.message(f.b, JSON.stringify({ type: "resize", cols: 90, rows: 30 }));
  f.input(f.a, "\r");
  expect(f.claims).toEqual(["private-a"]);
  f.input(f.a, "/li");
  f.input(f.b, "ve");
  f.input(f.a, "\r");
  expect(f.claims).toEqual(["private-a", undefined]);
  f.input(f.a, "old");
  f.input(f.b, "\x03");
  f.input(f.b, "/live\r");
  expect(f.claims.at(-1)).toBe("private-b");
  const marker = Buffer.from(BROWSER_INPUT_MARKER + f.ticket + "\x07\r").toString("hex");
  await until(() => f.output().includes(marker));
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

test("command captures its ticket before later dialog input and never renders markers", async () => {
  const input = createBrowserRequestInput();
  const first = "a".repeat(32),
    dialog = "b".repeat(32);
  expect(input.observe(BROWSER_INPUT_MARKER + first + "\x07")).toEqual({ consume: true });
  let finish!: () => void;
  const waited = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const submitted = input.take();
  const command = (async () => {
    await waited;
    return submitted;
  })();
  input.observe(BROWSER_INPUT_MARKER + dialog + "\x07");
  finish();
  expect(await command).toBe(first);
  expect(input.take()).toBe(dialog);
  expect(input.take()).toBeUndefined();
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
  expect(Buffer.concat(writes).toString()).toBe("\x1b[200~one\rtwo\x1b[201~");
  writes.length = 0;
  input.input(Buffer.from("\x1b"), "a");
  input.input(Buffer.from("\r"), "b");
  expect(claims).toEqual([undefined]);
  expect(Buffer.concat(writes).toString()).toBe(BROWSER_INPUT_MARKER + ticket + "\x07\x1b\r");
  input.close();
});
