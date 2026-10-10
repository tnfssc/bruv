import type { ServerWebSocket } from "bun";
import { afterEach, expect, test } from "bun:test";
import { TerminalSession, type SocketData } from "../../src/web/terminal";

const sessions: TerminalSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.stop()));
});
const command = [
  process.execPath,
  "-e",
  'process.stdin.setRawMode(true); console.log("RAW READY"); process.stdin.on("data", d => { const s=d.toString(); if(s==="query") process.stdout.write("\\x1b[6n"); else if(s==="split") { process.stdout.write("\\x1b["); setTimeout(()=>process.stdout.write("6n"),30); } else if(s==="batch") process.stdout.write("\\x1b[6n\\x1b[6n"); else if(s==="flood") process.stdout.write("x".repeat(3*1024*1024)+"FLOOD END"); else if(s==="offline") setTimeout(()=>process.stdout.write("\\x1b[6n"),50); else console.log("BYTES "+d.toString("hex")); }); setInterval(()=>{},1000);',
];
function create(ticket?: (owner: string | undefined) => string) {
  const session = new TerminalSession(command, process.cwd(), process.env, undefined, ticket);
  sessions.push(session);
  return session;
}
function viewer(session: TerminalSession, owner: string, after = 0) {
  const messages: any[] = [];
  const stub = {
    data: { channel: "terminal", audioOwner: owner, after },
    readyState: 1,
    getBufferedAmount: () => 0,
    send: (text: string) => {
      messages.push(JSON.parse(text));
      return 1;
    },
    close: () => {
      stub.readyState = 3;
    },
  };
  const socket = stub as unknown as ServerWebSocket<SocketData>;
  expect(session.attach(socket)).toBe(true);
  return {
    socket,
    messages,
    text: () =>
      messages
        .filter((m) => m.type === "output")
        .map((m) => Buffer.from(m.data, "base64").toString())
        .join(""),
    sequence: () => messages.filter((m) => m.type === "output").at(-1)?.seq ?? after,
    input: (data: string) => session.message(socket, JSON.stringify({ type: "input", data })),
    reply: (seq: number, data = "\x1b[1;1R") =>
      session.message(socket, JSON.stringify({ type: "terminal-reply", seq, data })),
    detach: () => {
      session.detach(socket);
      socket.close();
    },
  };
}
async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out");
    await Bun.sleep(5);
  }
}
const count = (text: string, value: string) => text.split(value).length - 1;

test("one session owns live, batched and split replies across viewers, replay and reconnect", async () => {
  const session = create();
  const a = viewer(session, "a");
  await until(() => a.text().includes("RAW READY"));
  const b = viewer(session, "b");
  // Navigation/visibility controls geometry, never reply ownership.
  session.message(a.socket, JSON.stringify({ type: "visibility", active: false }));
  a.input("query");
  await until(() => a.text().includes("\x1b[6n"));
  const seq = a.sequence();
  a.reply(seq);
  b.reply(seq);
  await until(() => a.text().includes("BYTES 1b5b313b3152"));
  const late = viewer(session, "late");
  late.reply(seq);
  const cursor = a.sequence();
  a.detach();
  const reconnect = viewer(session, "a", cursor);
  reconnect.reply(seq); // Delivery was uncertain; the ack may have been lost.
  await Bun.sleep(40);
  expect(count(b.text(), "BYTES 1b5b313b3152")).toBe(1);
  expect(reconnect.messages.some((m) => m.type === "terminal-reply-ack" && m.seq === seq)).toBe(true);

  b.input("split");
  await until(() => b.text().endsWith("\x1b["));
  const partial = b.sequence();
  await until(() => b.text().endsWith("6n"));
  expect(b.sequence()).toBeGreaterThan(partial);
  b.reply(b.sequence());
  late.reply(b.sequence());
  await until(() => count(b.text(), "BYTES 1b5b313b3152") === 2);
  b.input("batch");
  await until(() => b.text().endsWith("\x1b[6n\x1b[6n"));
  const batchSeq = b.sequence();
  b.reply(batchSeq, "\x1b[1;1R\x1b[1;1R");
  late.reply(batchSeq, "\x1b[1;1R\x1b[1;1R");
  await until(() => b.text().includes("BYTES 1b5b313b31521b5b313b3152"));
  await Bun.sleep(40);
  expect(count(b.text(), "BYTES 1b5b313b31521b5b313b3152")).toBe(1);
});

test("an unanswered query while offline completes once after reconnect", async () => {
  const session = create();
  const a = viewer(session, "a");
  await until(() => a.text().includes("RAW READY"));
  const cursor = a.sequence();
  a.input("offline");
  a.detach();
  await Bun.sleep(100);
  const b = viewer(session, "b", cursor);
  expect(b.text()).toContain("\x1b[6n");
  const seq = b.sequence();
  b.reply(seq);
  await until(() => b.text().includes("BYTES 1b5b313b3152"));
  const late = viewer(session, "late");
  late.reply(seq);
  await Bun.sleep(40);
  expect(count(b.text(), "BYTES 1b5b313b3152")).toBe(1);
});

test("protocol replies cannot mint human author tickets", async () => {
  const owners: (string | undefined)[] = [];
  const session = create((owner) => {
    owners.push(owner);
    return "1".repeat(32);
  });
  const a = viewer(session, "a");
  await until(() => a.text().includes("RAW READY"));
  const b = viewer(session, "b");
  a.input("/li");
  expect(owners).toEqual(["a"]);
  // Even an arbitrary protocol batch with Enter cannot call the human ticket path.
  b.reply(b.sequence(), "protocol\r");
  expect(owners).toEqual(["a"]);
  a.input("ve\r");
  expect(owners).toEqual(["a", "a"]);
  b.input(" typing\r");
  expect(owners).toEqual(["a", "a", "b"]);
});

test("a viewer cannot claim an output chunk it has not received; detached sockets cannot reply", async () => {
  const session = create();
  const a = viewer(session, "a");
  await until(() => a.text().includes("RAW READY"));
  const seq = a.sequence();
  a.reply(seq + 1);
  expect(a.socket.readyState).toBe(3);
  session.detach(a.socket);
  a.reply(seq);
  expect(a.messages.some((m) => m.type === "terminal-reply-ack")).toBe(false);
});

test("an evicted pending reply reports view loss instead of a false acknowledgement", async () => {
  const session = create();
  const a = viewer(session, "a");
  await until(() => a.text().includes("RAW READY"));
  const pid = session.pid;
  a.input("query");
  await until(() => a.text().includes("\x1b[6n"));
  const query = a.sequence();
  a.input("flood");
  await until(() => a.text().endsWith("FLOOD END"));
  const cursor = a.sequence();
  a.detach();
  const retry = viewer(session, "retry", cursor);
  retry.reply(query);
  expect(retry.messages.some((message) => message.type === "gap")).toBe(true);
  expect(retry.messages.some((message) => message.type === "terminal-reply-ack")).toBe(false);
  expect(retry.socket.readyState).toBe(3);
  retry.detach();
  const healthy = viewer(session, "healthy", cursor);
  healthy.input("barrier");
  await until(() => healthy.text().includes("BYTES 62617272696572"));
  expect(healthy.text()).not.toContain("BYTES 1b5b");
  expect(session.pid).toBe(pid);
  expect(session.exited).toBe(false);
});
