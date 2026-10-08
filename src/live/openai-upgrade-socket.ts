import WebSocket from "ws";
import type { IncomingMessage } from "node:http";
import type { RealtimeSocket } from "./openai-session";

/** Own the rejected HTTP response until its bounded diagnostic is read or cancelled. */
function readRejectionCode(response: IncomingMessage, report: (code?: unknown) => void): () => void {
  let done = false;
  let bytes = 0;
  const chunks: Buffer[] = [];
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    response.destroy();
  };
  const finish = (code?: unknown) => {
    if (done) return;
    stop();
    report(code);
  };
  const timer = setTimeout(() => finish(), 1000);
  timer.unref?.();
  // Read at most 4 KiB. Only error.code is passed to the redacting connection diagnostics.
  response.on("data", (chunk: Buffer) => {
    if (done) return;
    bytes += chunk.length;
    if (bytes > 4096) finish();
    else chunks.push(chunk);
  });
  response.on("end", () => {
    if (done) return;
    let code: unknown;
    try {
      code = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error?.code;
    } catch {
      /* malformed */
    }
    finish(code);
  });
  response.on("error", () => finish());
  return stop;
}

/** ws exposes the HTTP upgrade response; Bun's native WebSocket does not (Bun 1.4.2).
 * One authenticated Upgrade only, never a second REST probe. The session's connection
 * diagnostics classify status and allowlist provider codes, without exposing response text.
 */
export function upgradeSocket(url: string, headers: Record<string, string>): RealtimeSocket {
  const ws = new WebSocket(url, { headers, handshakeTimeout: 15000, followRedirects: false });
  const listeners = new Map<string, Array<(event: any) => void>>();
  const emit = (type: string, event: unknown) => {
    for (const handler of listeners.get(type) ?? []) handler(event);
  };
  let rejected = false;
  let cancelRejection: (() => void) | undefined;
  ws.on("unexpected-response", (_request, response) => {
    // We own rejection diagnostics and shutdown now; ws error/close must not race
    // the HTTP status with an unclassified transport failure.
    rejected = true;
    const status = response.statusCode ?? 0;
    cancelRejection = readRejectionCode(response, (code) => {
      emit("error", { status, providerCode: code, model: new URL(url).searchParams.get("model") });
      ws.terminate();
    });
  });
  ws.on("open", () => emit("open", {}));
  ws.on("message", (data, binary) => emit("message", { data: binary ? data : data.toString() }));
  ws.on("error", () => {
    if (!rejected) emit("error", {});
  });
  ws.on("close", () => {
    if (!rejected) emit("close", {});
  });
  return {
    get readyState() {
      return ws.readyState;
    },
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
    send(data) {
      ws.send(data);
    },
    close() {
      cancelRejection?.();
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else ws.close();
    },
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
  };
}
