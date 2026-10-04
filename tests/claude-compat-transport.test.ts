import { describe, expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { ClaudeCompatTransport, type TransportOptions } from "../src/claude-compat/transport";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(options: Partial<TransportOptions> = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();
  const lines: any[] = [];
  const logs: string[] = [];
  let buffer = "";
  output.on("data", (chunk) => {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      lines.push(JSON.parse(buffer.slice(0, end)));
      buffer = buffer.slice(end + 1);
    }
  });
  stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const transport = new ClaudeCompatTransport({ input, output, stderr, onUser: () => {}, controls: {}, ...options });
  const run = transport.run();
  // A rejection is still inspected by each test, but never becomes unhandled.
  void run.catch(() => {});
  return {
    input,
    output,
    logs,
    lines,
    transport,
    run,
    write: (value: unknown) => input.write(JSON.stringify(value) + "\n"),
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const user = {
  type: "user",
  message: { role: "user", content: "hello 😀" },
  parent_tool_use_id: null,
  uuid: "source-user-id",
  session_id: "source-session",
};
const control = (id: string, request: any) => ({ type: "control_request", request_id: id, request });
const success = (id: string, response?: any) => ({
  type: "control_response",
  response: { subtype: "success", request_id: id, ...(response === undefined ? {} : { response }) },
});

describe("Claude-compatible NDJSON transport", () => {
  test("fragmented UTF-8, CRLF and final non-newline user frames preserve source IDs", async () => {
    const received: unknown[] = [];
    const h = harness({
      onUser: (message) => {
        received.push(message);
      },
    });
    const bytes = Buffer.from(JSON.stringify(user) + "\r\n" + JSON.stringify(user));
    for (const byte of bytes) h.input.write(Buffer.from([byte]));
    h.input.end();
    await h.run;
    expect(received).toEqual([user, user]);
    expect(h.lines).toEqual([]);
  });

  test("SDK initialize, interrupt and config route explicitly; unsupported/malformed controls get real errors", async () => {
    const captured: unknown[] = [];
    const h = harness({
      controls: {
        initialize: (envelope) => {
          captured.push(envelope);
          return { commands: [], agents: [], models: [], account: {} };
        },
        interrupt: () => {},
        set_model: (envelope) => {
          if (typeof envelope.request.model !== "string") throw new Error("model must be a string");
        },
      },
    });
    const init = control("sdk-init", { subtype: "initialize", hooks: {}, sdkMcpServers: [], supportedDialogKinds: [] });
    h.write(init);
    h.write(control("sdk-interrupt", { subtype: "interrupt", cancel_queued: true }));
    h.write(control("sdk-config", { subtype: "set_model", model: "bruv-configured-model" }));
    h.write(control("sdk-bad-config", { subtype: "set_model", model: 7 }));
    h.write(control("sdk-unsupported", { subtype: "get_account_info" }));
    h.write(control("sdk-malformed", null));
    h.input.end();
    await h.run;
    expect(captured).toEqual([init]);
    expect(h.lines.find((x) => x.response.request_id === "sdk-init")).toEqual(
      success("sdk-init", { commands: [], agents: [], models: [], account: {} }),
    );
    expect(h.lines.find((x) => x.response.request_id === "sdk-interrupt")).toEqual(success("sdk-interrupt"));
    expect(h.lines.find((x) => x.response.request_id === "sdk-config")).toEqual(success("sdk-config"));
    for (const id of ["sdk-bad-config", "sdk-unsupported", "sdk-malformed"])
      expect(h.lines.find((x) => x.response.request_id === id).response.subtype).toBe("error");
  });

  test("permission response and interrupt continue flowing while the prompt handler awaits the peer", async () => {
    const done = deferred();
    let answer: unknown;
    const h = harness({
      onUser: async () => {
        answer = await h.transport.request(
          {
            subtype: "can_use_tool",
            tool_name: "Read",
            tool_use_id: "original-tool-id",
            input: { file_path: "/tmp/example" },
          },
          { requestId: "permission-id" },
        );
        await h.transport.send({ type: "result", uuid: "engine-result-id", result: "fixture only" });
        done.resolve();
      },
      controls: { interrupt: () => {} },
    });
    h.write(user);
    await tick();
    expect(h.lines[0]).toEqual(
      control("permission-id", {
        subtype: "can_use_tool",
        tool_name: "Read",
        tool_use_id: "original-tool-id",
        input: { file_path: "/tmp/example" },
      }),
    );
    h.write(control("interrupt-id", { subtype: "interrupt" }));
    await tick();
    expect(h.lines[1]).toEqual(success("interrupt-id"));
    h.write(success("unrelated", { behavior: "deny", message: "not this request" }));
    h.write(
      success("permission-id", {
        behavior: "allow",
        updatedInput: { file_path: "/tmp/example" },
        toolUseID: "original-tool-id",
      }),
    );
    await done.promise;
    h.input.end();
    await h.run;
    expect(answer).toEqual({
      behavior: "allow",
      updatedInput: { file_path: "/tmp/example" },
      toolUseID: "original-tool-id",
    });
    expect(h.lines[2].uuid).toBe("engine-result-id");
  });

  test("callback abort emits cancellation and late responses do not revive it", async () => {
    const h = harness();
    const controller = new AbortController();
    const request = h.transport.request(
      { subtype: "can_use_tool" },
      { signal: controller.signal, requestId: "cancel-me" },
    );
    controller.abort(new Error("turn interrupted"));
    await expect(request).rejects.toThrow("turn interrupted");
    await tick();
    expect(h.lines.map((x) => x.type)).toEqual(["control_request", "control_cancel_request"]);
    h.write(success("cancel-me", { behavior: "allow" }));
    h.input.end();
    await h.run;
  });

  test("incoming cancellation aborts the injected handler and returns a correlated error", async () => {
    const entered = deferred();
    const h = harness({
      controls: {
        initialize: (_message, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            entered.resolve();
          }),
      },
    });
    h.write(control("init", { subtype: "initialize" }));
    await entered.promise;
    h.write({ type: "control_cancel_request", request_id: "init" });
    h.input.end();
    await h.run;
    expect(h.lines[0].response).toEqual({
      subtype: "error",
      request_id: "init",
      error: "Peer cancelled control request",
    });
  });

  test("EOF rejects pending callbacks, drains accepted output, and rejects new callbacks", async () => {
    const h = harness({
      onUser: async () => {
        await tick();
        await h.transport.send({ type: "result", uuid: "kept" });
      },
    });
    const pending = h.transport.request({ subtype: "can_use_tool" });
    h.write(user);
    h.input.end();
    await expect(pending).rejects.toThrow("input ended");
    await h.run;
    expect(h.lines.at(-1)).toEqual({ type: "result", uuid: "kept" });
    await expect(h.transport.request({ subtype: "can_use_tool" })).rejects.toThrow("input ended");
  });

  test("explicit close aborts handlers and rejects callbacks/writes without waiting forever", async () => {
    let signal: AbortSignal | undefined;
    const entered = deferred();
    const h = harness({
      onUser: (_message, value) => {
        signal = value;
        entered.resolve();
        return new Promise(() => {});
      },
    });
    h.write(user);
    await entered.promise;
    const pending = h.transport.request({ subtype: "can_use_tool" });
    h.transport.close(new Error("shutdown"));
    await expect(pending).rejects.toThrow("shutdown");
    await expect(h.run).rejects.toThrow("shutdown");
    await expect(h.transport.send({ type: "result" })).rejects.toThrow("shutdown");
    expect(signal?.aborted).toBe(true);
  });

  test("writes are ordered and wait for real stream backpressure", async () => {
    const chunks: string[] = [];
    const releases: Array<() => void> = [];
    const output = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        releases.push(() => callback());
      },
    });
    const h = harness({ output });
    let completed = false;
    const first = h.transport.send({ type: "result", uuid: "one" }).then(() => {
      completed = true;
    });
    const second = h.transport.send({ type: "result", uuid: "two" });
    await tick();
    expect(chunks.length).toBe(1);
    expect(completed).toBe(false);
    releases.shift()!();
    await first;
    await tick();
    expect(chunks.length).toBe(2);
    releases.shift()!();
    await second;
    h.input.end();
    await h.run;
    expect(chunks.map((x) => JSON.parse(x).uuid)).toEqual(["one", "two"]);
  });

  test("malformed frames use stderr, never fabricated stdout envelopes", async () => {
    const h = harness();
    h.input.write('not-json\nnull\n{"type":"unknown"}\n');
    h.write({ ...user, message: { role: "assistant", content: "wrong" } });
    h.write({ type: "control_request", request: { subtype: "initialize" } });
    h.input.end();
    await h.run;
    expect(h.lines).toEqual([]);
    expect(h.logs.join("")).toContain("Malformed JSON");
    expect(h.logs.length).toBe(5);
  });

  test("malformed or error peer responses reject the matching callback", async () => {
    const h = harness();
    const bad = h.transport.request({ subtype: "can_use_tool" }, { requestId: "bad" });
    const denied = h.transport.request({ subtype: "can_use_tool" }, { requestId: "denied" });
    void denied.catch(() => {});
    h.write(success("bad", 7));
    h.write({ type: "control_response", response: { subtype: "error", request_id: "denied", error: "peer failed" } });
    await expect(bad).rejects.toThrow("Malformed control response");
    await expect(denied).rejects.toThrow("peer failed");
    h.input.end();
    await h.run;
  });

  test("frame, pending callback and write-queue budgets bound retained work", async () => {
    const h = harness({ maxFrameBytes: 120, maxPendingRequests: 1, maxQueuedWriteBytes: 130 });
    const pending = h.transport.request({ subtype: "interrupt" }, { requestId: "one" });
    await expect(h.transport.request({ subtype: "interrupt" })).rejects.toThrow("Too many pending");
    await expect(h.transport.send({ type: "result", text: "x".repeat(200) })).rejects.toThrow("output limit");
    void pending.catch(() => {});
    h.input.write("x".repeat(121));
    await expect(h.run).rejects.toThrow("frame limit");
    await expect(pending).rejects.toThrow("frame limit");
  });

  test("output failure tears down pending requests and blocked drain", async () => {
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        callback(new Error("broken pipe"));
      },
    });
    const h = harness({ output });
    const pending = h.transport.request({ subtype: "can_use_tool" });
    await expect(pending).rejects.toThrow("broken pipe");
    await expect(h.run).rejects.toThrow("broken pipe");
  });
  test("multiple outbound callbacks correlate out of order and absent acknowledgement bodies are empty objects", async () => {
    const h = harness();
    const first = h.transport.request({ subtype: "can_use_tool" }, { requestId: "first" });
    const second = h.transport.request({ subtype: "can_use_tool" }, { requestId: "second" });
    await expect(h.transport.request({ subtype: "can_use_tool" }, { requestId: "first" })).rejects.toThrow("Duplicate");
    h.write(success("second", { behavior: "deny", message: "human declined" }));
    expect(await second).toEqual({ behavior: "deny", message: "human declined" });
    h.write(success("first"));
    expect(await first).toEqual({});
    h.input.end();
    await h.run;
  });

  test("active handler budget returns a correlated error without accepting extra work", async () => {
    const gate = deferred<Record<string, unknown>>();
    let interrupts = 0;
    const h = harness({
      maxActiveHandlers: 1,
      controls: {
        initialize: () => gate.promise,
        interrupt: () => {
          interrupts++;
        },
      },
    });
    h.write(control("init", { subtype: "initialize" }));
    await tick();
    h.write(control("interrupt", { subtype: "interrupt" }));
    await tick();
    expect(h.lines[0].response).toEqual({
      subtype: "error",
      request_id: "interrupt",
      error: "Too many active handlers",
    });
    expect(interrupts).toBe(0);
    gate.resolve({});
    h.input.end();
    await h.run;
  });

  test("queued-write byte budget rejects extra output during backpressure", async () => {
    let release!: () => void;
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        release = () => callback();
      },
    });
    const h = harness({ output, maxQueuedWriteBytes: 50 });
    const first = h.transport.send({ type: "result", uuid: "one" });
    await expect(h.transport.send({ type: "result", uuid: "two" })).rejects.toThrow("output limit");
    await tick();
    release();
    await first;
    h.input.end();
    await h.run;
  });
});
