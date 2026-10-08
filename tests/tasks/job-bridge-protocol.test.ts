import { expect, spyOn, test } from "bun:test";
import { getEventListeners } from "node:events";
import { Duplex, PassThrough } from "node:stream";
import { inspectDiagnostics } from "../../src/diagnostics";
import { installJobGlobals, MAX_JOB_BRIDGE_FRAME_BYTES, serveJobBridge } from "../../src/typescript/job-bridge";
import { JOB_RESPONSE_ACK_EVENT, withJobCancellation } from "../../src/job-delivery";

function socket() {
  return new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}
for (const [frame, code] of [
  ["{invalid-secret-frame\n", "protocol_invalid"],
  [JSON.stringify({ id: 1, method: 42, params: "secret" }) + "\n", "protocol_invalid"],
  ["x".repeat(MAX_JOB_BRIDGE_FRAME_BYTES + 1), "frame_oversize"],
] as const) {
  test(
    "server classifies malformed envelope or frame without retaining payload: " + code + ":" + frame.length,
    async () => {
      const stream = socket(),
        owner = {};
      let calls = 0;
      const bridge = serveJobBridge(
        stream,
        async () => {
          calls++;
        },
        new AbortController().signal,
        owner,
      );
      try {
        stream.push(Buffer.from(frame));
        await Bun.sleep(1);
        expect(calls).toBe(0);
        const records = inspectDiagnostics(owner).records;
        expect(records.some((record) => record.code === code)).toBe(true);
        expect(JSON.stringify(records)).not.toContain("secret");
      } finally {
        bridge.close();
      }
    },
  );
}

test("invalid ACK and parent cancellation release requests exactly once with distinct causes", async () => {
  for (const cause of ["ack", "shutdown", "timeout", "caller"] as const) {
    const stream = socket(),
      owner = {},
      abort = new AbortController();
    let released = 0;
    const bridge = serveJobBridge(
      stream,
      async (_m, _p, signal) => {
        signal.addEventListener(
          "abort",
          () => {
            released++;
          },
          { once: true },
        );
        return new Promise(() => {});
      },
      abort.signal,
      owner,
    );
    try {
      stream.push(Buffer.from(JSON.stringify({ id: 1, method: "shell", params: { command: "secret" } }) + "\n"));
      await Bun.sleep(1);
      if (cause === "ack") stream.push(Buffer.from('{"ack":1}\n'));
      else abort.abort(cause);
      await Bun.sleep(1);
      bridge.close();
      bridge.close();
      expect(released).toBe(1);
      const records = inspectDiagnostics(owner).records;
      const code = cause === "ack" ? "protocol_invalid" : cause === "caller" ? "caller_aborted" : cause;
      expect(records.some((record) => record.code === code)).toBe(true);
      expect(JSON.stringify(records)).not.toContain("secret");
    } finally {
      bridge.close();
    }
  }
});

const jobGlobalNames = [
  "shell",
  "subagent",
  "handoff",
  "remote",
  "history",
  "goal",
  "live",
  "questions",
  "jobs",
] as const;

/** Own the socket and every global replaced by installJobGlobals, including absent globals. */
async function withJobClient(stream: Duplex, run: (client: ReturnType<typeof installJobGlobals>) => Promise<void>) {
  const saved = jobGlobalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  try {
    await run(installJobGlobals(stream));
  } finally {
    stream.destroy();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("client EPIPE has a stable symbolic category rather than generic disconnect", async () => {
  const stream = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error("secret"), { code: "EPIPE" }));
    },
  });
  await withJobClient(stream, async (client) => {
    const error = await globalThis.shell("secret-command").catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code: string }).code).toBe("bridge_epipe");
    expect((error as Error).message).not.toContain("secret");
    await client.finish();
  });
});

test("client and server reject an accumulated oversized frame before concatenating it", async () => {
  const originalConcat = Buffer.concat;
  const concat = spyOn(Buffer, "concat").mockImplementation(((list: readonly Uint8Array[], totalLength?: number) => {
    const length = totalLength ?? list.reduce((sum, item) => sum + item.length, 0);
    if (length > MAX_JOB_BRIDGE_FRAME_BYTES) throw new Error("oversized concat attempted");
    return originalConcat(list, totalLength);
  }) as typeof Buffer.concat);
  try {
    const serverSocket = socket(),
      owner = {};
    const bridge = serveJobBridge(serverSocket, async () => null, new AbortController().signal, owner);
    try {
      serverSocket.push(Buffer.alloc(Math.floor(MAX_JOB_BRIDGE_FRAME_BYTES / 2), 120));
      serverSocket.push(Buffer.alloc(Math.ceil(MAX_JOB_BRIDGE_FRAME_BYTES / 2) + 1, 120));
      await Bun.sleep(1);
      expect(inspectDiagnostics(owner).records.some((record) => record.code === "frame_oversize")).toBe(true);
    } finally {
      bridge.close();
    }

    const clientSocket = socket();
    await withJobClient(clientSocket, async (client) => {
      const request = globalThis.shell("echo ok");
      clientSocket.push(Buffer.alloc(Math.floor(MAX_JOB_BRIDGE_FRAME_BYTES / 2), 120));
      clientSocket.push(Buffer.alloc(Math.ceil(MAX_JOB_BRIDGE_FRAME_BYTES / 2) + 1, 120));
      const error = await request.catch((reason) => reason);
      expect((error as Error & { code: string }).code).toBe("frame_oversize");
      await client.finish();
    });
  } finally {
    concat.mockRestore();
  }
});

test("client and server accept multi-frame chunks larger than one frame limit", async () => {
  const payload = "x".repeat(Math.floor(MAX_JOB_BRIDGE_FRAME_BYTES * 0.51));
  const requests = [1, 2].map((id) => JSON.stringify({ id, method: "test", params: payload }) + "\n").join("");
  expect(Buffer.byteLength(requests)).toBeGreaterThan(MAX_JOB_BRIDGE_FRAME_BYTES);
  const serverSocket = socket();
  let calls = 0;
  const bridge = serveJobBridge(
    serverSocket,
    async () => {
      calls++;
      return null;
    },
    new AbortController().signal,
  );
  try {
    serverSocket.push(Buffer.from(requests));
    await Bun.sleep(1);
    expect(calls).toBe(2);
  } finally {
    bridge.close();
  }

  const clientSocket = socket();
  await withJobClient(clientSocket, async (client) => {
    const first = globalThis.shell("one");
    const second = globalThis.shell("two");
    const responses = [1, 2].map((id) => JSON.stringify({ id, result: payload }) + "\n").join("");
    expect(Buffer.byteLength(responses)).toBeGreaterThan(MAX_JOB_BRIDGE_FRAME_BYTES);
    clientSocket.push(Buffer.from(responses));
    expect(await first).toBe(payload);
    expect(await second).toBe(payload);
    await client.finish();
  });
});

function bridgePair(): { server: Duplex; worker: Duplex } {
  const requests = new PassThrough();
  const responses = new PassThrough();
  const fromPair = Duplex.from as unknown as (pair: { readable: PassThrough; writable: PassThrough }) => Duplex;
  const server = fromPair({ readable: requests, writable: responses });
  const worker = fromPair({ readable: responses, writable: requests });
  // Duplex.from propagates peer destruction as AbortError; bridge shutdown is
  // expected to destroy its owned endpoint in these protocol tests.
  server.on("error", () => {});
  worker.on("error", () => {});
  return { server, worker };
}

function nextFrame(stream: Duplex): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    stream.once("data", (chunk: Buffer) => {
      try {
        resolve(JSON.parse(chunk.toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

test("acknowledged non-launch RPCs release request cancellation listeners immediately", async () => {
  const { server, worker } = bridgePair();
  const cancellation = new AbortController();
  const bridge = serveJobBridge(
    server,
    async (_method, _params, signal) => {
      withJobCancellation(signal, cancellation.signal);
      return { ok: true };
    },
    new AbortController().signal,
  );
  try {
    for (let id = 1; id <= 100; id++) {
      const response = nextFrame(worker);
      worker.write(JSON.stringify({ id, method: "jobs.list", params: {} }) + "\n");
      expect(await response).toEqual({ id, result: { ok: true } });
      expect(getEventListeners(cancellation.signal, "abort")).toHaveLength(1);
      worker.write(JSON.stringify({ ack: id }) + "\n");
      await Bun.sleep(0);
      expect(getEventListeners(cancellation.signal, "abort")).toHaveLength(0);
    }
  } finally {
    bridge.close();
    worker.destroy();
  }
});

test("failed RPCs release controllers while foreground ACK ownership stays provisional", async () => {
  const { server, worker } = bridgePair();
  const cancellation = new AbortController();
  const bridge = serveJobBridge(
    server,
    async (method, params, signal) => {
      withJobCancellation(signal, cancellation.signal);
      if (method === "jobs.stop") throw new Error("failed");
      return params;
    },
    new AbortController().signal,
  );
  try {
    let response = nextFrame(worker);
    worker.write(JSON.stringify({ id: 1, method: "jobs.stop", params: {} }) + "\n");
    expect(await response).toEqual({ id: 1, error: "failed" });
    expect(getEventListeners(cancellation.signal, "abort")).toHaveLength(0);
    worker.write('{"ack":1}\n');

    response = nextFrame(worker);
    worker.write(JSON.stringify({ id: 2, method: "shell", params: { background: true } }) + "\n");
    expect(await response).toEqual({ id: 2, result: { background: true } });
    worker.write('{"ack":2}\n');
    await Bun.sleep(0);
    expect(getEventListeners(cancellation.signal, "abort")).toHaveLength(0);

    response = nextFrame(worker);
    worker.write(JSON.stringify({ id: 3, method: "shell", params: { background: false } }) + "\n");
    expect(await response).toEqual({ id: 3, result: { background: false } });
    worker.write('{"ack":3}\n');
    await Bun.sleep(0);
    expect(getEventListeners(cancellation.signal, "abort")).toHaveLength(1);

    bridge.close(true);
    expect(getEventListeners(cancellation.signal, "abort")).toHaveLength(0);
  } finally {
    bridge.close();
    worker.destroy();
  }
});

for (const commit of [false, true]) {
  test(
    "foreground batch ACK survives transport end but transfers ownership only on committed close: " + commit,
    async () => {
      const { server, worker } = bridgePair();
      const events: string[] = [];
      const bridge = serveJobBridge(
        server,
        async (_method, _params, signal) => {
          signal.addEventListener(JOB_RESPONSE_ACK_EVENT, () => events.push("ack"));
          signal.addEventListener("abort", () => events.push("abort"));
          return [{ background: true }, { background: false }];
        },
        new AbortController().signal,
      );
      try {
        const response = nextFrame(worker);
        worker.write('{"id":1,"method":"subagent","params":{}}\n');
        expect(await response).toEqual({ id: 1, result: [{ background: true }, { background: false }] });
        worker.write('{"ack":1}\n');
        // Exercise the same end callback that runs before executeIsolated sees
        // worker close. Receipt must neither commit nor relinquish ownership.
        const ended = new Promise<void>((resolve) => server.once("end", resolve));
        worker.end();
        await ended;
        expect(events).toEqual([]);
        bridge.close(commit);
        bridge.close(commit);
        expect(events).toEqual(commit ? ["ack", "abort"] : ["abort"]);
      } finally {
        bridge.close();
        worker.destroy();
      }
    },
  );
}

test("replayed foreground ACK rejects the protocol and restores notification ownership", async () => {
  const { server, worker } = bridgePair();
  const owner = {};
  const events: string[] = [];
  const bridge = serveJobBridge(
    server,
    async (_method, _params, signal) => {
      signal.addEventListener(JOB_RESPONSE_ACK_EVENT, () => events.push("ack"));
      signal.addEventListener("abort", () => events.push("abort"));
      return { background: false };
    },
    new AbortController().signal,
    owner,
  );
  try {
    const response = nextFrame(worker);
    worker.write('{"id":1,"method":"shell","params":{}}\n');
    expect(await response).toEqual({ id: 1, result: { background: false } });
    const closed = new Promise<void>((resolve) => server.once("close", resolve));
    worker.write('{"ack":1}\n{"ack":1}\n');
    await closed;
    bridge.close(true);
    expect(events).toEqual(["abort"]);
    expect(inspectDiagnostics(owner).records.some((record) => record.code === "protocol_invalid")).toBe(true);
  } finally {
    bridge.close();
    worker.destroy();
  }
});

for (const fail of [false, true]) {
  test("client fixture restores every installed global after " + (fail ? "failure" : "success"), async () => {
    const saved = jobGlobalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    const stream = socket();
    const failure = new Error("fixture body failed");
    try {
      const run = withJobClient(stream, async (client) => {
        if (fail) throw failure;
        await client.finish();
      });
      if (fail) await expect(run).rejects.toBe(failure);
      else await run;
      expect(stream.destroyed).toBe(true);
      for (const [name, descriptor] of saved) {
        expect(Object.getOwnPropertyDescriptor(globalThis, name)).toEqual(descriptor);
      }
    } finally {
      // Keep this regression from contaminating later tests if restoration breaks.
      stream.destroy();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
}
