import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";

/** Envelope subset from @anthropic-ai/claude-agent-sdk 0.3.276 sdk.d.ts.
 * Payload validation and all session semantics belong to the injected engine.
 * Unknown fields are retained, never reconstructed or assigned new source IDs.
 */
export interface UserMessage {
  type: "user";
  message: { role: "user"; content: string | unknown[]; [key: string]: unknown };
  parent_tool_use_id: string | null;
  uuid?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface ControlRequest {
  type: "control_request";
  request_id: string;
  request: { subtype: string; [key: string]: unknown };
}

export interface ControlResponse {
  type: "control_response";
  response:
    | { subtype: "success"; request_id: string; response?: Record<string, unknown>; [key: string]: unknown }
    | { subtype: "error"; request_id: string; error: string; [key: string]: unknown };
}

export interface ControlCancelRequest {
  type: "control_cancel_request";
  request_id: string;
}

export interface PermissionRequest {
  subtype: "can_use_tool";
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id: string;
  [key: string]: unknown;
}

export type WireMessage = { type: string; [key: string]: unknown };
export type ControlHandler = (
  message: ControlRequest,
  signal: AbortSignal,
  // biome-ignore lint/suspicious/noConfusingVoidType: Async handlers may acknowledge without returning a payload.
) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;

export interface TransportOptions {
  input: Readable;
  output: Writable;
  /** Must be stderr (or a dedicated diagnostic sink), never protocol stdout. */
  stderr?: Pick<Writable, "write">;
  onUser: (message: UserMessage, signal: AbortSignal) => void | Promise<void>;
  /** Explicit method table: absent methods receive correlated protocol errors. */
  controls: Record<string, ControlHandler>;
  maxFrameBytes?: number;
  maxPendingRequests?: number;
  maxActiveHandlers?: number;
  maxQueuedWriteBytes?: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
}

/** Single-use NDJSON transport. Close stops/destroys input; output is caller-owned.
 * Handlers run concurrently so interrupts and peer responses cannot deadlock a
 * running prompt. The engine must queue user turns and serialize state changes.
 */
export class ClaudeCompatTransport {
  readonly #options: TransportOptions;
  readonly #lifetime = new AbortController();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #incoming = new Map<string, AbortController>();
  readonly #active = new Set<Promise<void>>();
  readonly #maxFrame: number;
  readonly #maxPending: number;
  readonly #maxActive: number;
  readonly #maxQueued: number;
  #queuedBytes = 0;
  #writeTail: Promise<void> = Promise.resolve();
  #started = false;
  #inputEnded = false;
  #closed: Error | undefined;

  constructor(options: TransportOptions) {
    this.#options = options;
    this.#maxFrame = options.maxFrameBytes ?? 8 * 1024 * 1024;
    this.#maxPending = options.maxPendingRequests ?? 128;
    this.#maxActive = options.maxActiveHandlers ?? 128;
    this.#maxQueued = options.maxQueuedWriteBytes ?? 16 * 1024 * 1024;
    for (const limit of [this.#maxFrame, this.#maxPending, this.#maxActive, this.#maxQueued]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Transport limits must be positive integers");
    }
  }

  /** Ordered writes; resolves only after the frame is written and drain observed. */
  send(message: WireMessage | ControlRequest | ControlResponse | ControlCancelRequest): Promise<void> {
    if (this.#closed) return Promise.reject(this.#closed);
    let frame: string;
    try {
      frame = `${JSON.stringify(message)}\n`;
    } catch (reason) {
      return Promise.reject(error(reason));
    }
    const bytes = Buffer.byteLength(frame);
    if (bytes - 1 > this.#maxFrame || this.#queuedBytes + bytes > this.#maxQueued) {
      return Promise.reject(new Error("Transport output limit exceeded"));
    }
    this.#queuedBytes += bytes;
    const write = this.#writeTail.then(() => this.#write(frame));
    this.#writeTail = write.catch((reason) => this.close(error(reason)));
    return write.finally(() => {
      this.#queuedBytes -= bytes;
    });
  }

  /** Send a peer callback (e.g. can_use_tool). Caller validates its response body.
   * Only new outbound request IDs are generated here; source IDs are untouched.
   */
  request(
    request: ControlRequest["request"] | PermissionRequest,
    options: { signal?: AbortSignal; requestId?: string } = {},
  ): Promise<Record<string, unknown>> {
    if (this.#closed || this.#inputEnded) return Promise.reject(this.#closed ?? new Error("Transport input ended"));
    if (options.signal?.aborted) return Promise.reject(error(options.signal.reason));
    if (this.#pending.size >= this.#maxPending) return Promise.reject(new Error("Too many pending control requests"));
    const id = options.requestId ?? randomUUID();
    if (!id || this.#pending.has(id)) return Promise.reject(new Error("Duplicate or empty outbound request ID"));
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.#settle(id, error(options.signal?.reason ?? "Control request cancelled"));
        void this.send({ type: "control_cancel_request", request_id: id }).catch(() => {});
      };
      const cleanup = () => options.signal?.removeEventListener("abort", cancel);
      this.#pending.set(id, { resolve, reject, cleanup });
      options.signal?.addEventListener("abort", cancel, { once: true });
      void this.send({ type: "control_request", request_id: id, request }).catch((reason) =>
        this.#settle(id, error(reason)),
      );
    });
  }

  close(reason = new Error("Transport closed")): void {
    if (this.#closed) return;
    this.#closed = reason;
    this.#lifetime.abort(reason);
    for (const controller of this.#incoming.values()) controller.abort(reason);
    this.#incoming.clear();
    for (const id of this.#pending.keys()) this.#settle(id, reason);
  }

  /** EOF rejects outbound callbacks but drains accepted handlers and output.
   * Explicit close/error aborts immediately. Handlers must honor their signal.
   */
  async run(): Promise<void> {
    if (this.#started) throw new Error("Transport already started");
    this.#started = true;
    const { input, output } = this.#options;
    const failed = (reason: Error) => this.close(reason);
    const outputClosed = () => this.close(new Error("Transport output closed"));
    const stopInput = () => input.destroy();
    input.on("error", failed);
    output.on("error", failed);
    output.on("close", outputClosed);
    this.#lifetime.signal.addEventListener("abort", stopInput, { once: true });
    let frame = Buffer.alloc(0);
    let size = 0;
    try {
      if (this.#closed) throw this.#closed;
      for await (const chunk of input) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let offset = 0;
        while (offset < buffer.length) {
          const newline = buffer.indexOf(10, offset);
          const end = newline < 0 ? buffer.length : newline;
          const slice = buffer.subarray(offset, end);
          const nextSize = size + slice.length;
          if (nextSize > this.#maxFrame) throw new Error("Transport input frame limit exceeded");
          // One geometrically grown buffer bounds both bytes and fragment metadata.
          // Do not retain incoming pooled slabs or millions of tiny Buffer objects.
          if (nextSize > frame.length) {
            const next = Buffer.allocUnsafe(Math.min(this.#maxFrame, Math.max(nextSize, frame.length * 2, 4096)));
            frame.copy(next, 0, 0, size);
            frame = next;
          }
          slice.copy(frame, size);
          size = nextSize;
          if (newline < 0) break;
          const line = frame.subarray(0, size).toString("utf8").trim();
          frame = Buffer.alloc(0);
          size = 0;
          if (line) await this.#dispatchLine(line);
          offset = end + 1;
        }
      }
      if (size) {
        const line = frame.subarray(0, size).toString("utf8").trim();
        if (line) await this.#dispatchLine(line);
      }
      this.#inputEnded = true;
      for (const id of this.#pending.keys()) this.#settle(id, new Error("Transport input ended"));
      await this.#waitFor(Promise.all(this.#active));
      await this.#writeTail;
      if (this.#closed) throw this.#closed;
      this.close(new Error("Transport input ended"));
    } catch (reason) {
      this.close(error(reason));
      throw this.#closed;
    } finally {
      input.off("error", failed);
      output.off("error", failed);
      output.off("close", outputClosed);
      this.#lifetime.signal.removeEventListener("abort", stopInput);
    }
  }

  #waitFor<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const signal = this.#lifetime.signal;
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(this.#closed);
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (reason) => {
          signal.removeEventListener("abort", abort);
          reject(reason);
        },
      );
    });
  }

  #log(message: string): void {
    (this.#options.stderr ?? process.stderr).write(`[claude-compat] ${message}\n`);
  }

  #settle(id: string, reason?: Error, value: Record<string, unknown> = {}): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.cleanup();
    if (reason) pending.reject(reason);
    else pending.resolve(value);
  }

  async #protocolError(id: string | undefined, message: string): Promise<void> {
    if (id)
      await this.send({ type: "control_response", response: { subtype: "error", request_id: id, error: message } });
    else this.#log(message); // No valid correlation ID: don't invent a wire error envelope.
  }

  async #dispatchLine(line: string): Promise<void> {
    if (this.#closed) throw this.#closed;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.#log("Malformed JSON frame");
      return;
    }
    if (!object(message)) {
      this.#log("Expected a protocol object");
      return;
    }
    if (message.type === "control_response") {
      const response = message.response;
      if (!object(response) || typeof response.request_id !== "string") {
        this.#log("Malformed control response");
        return;
      }
      const id = response.request_id;
      if (response.subtype === "error" && typeof response.error === "string")
        this.#settle(id, new Error(response.error));
      else if (response.subtype === "success" && (response.response === undefined || object(response.response)))
        this.#settle(id, undefined, response.response ?? {});
      else {
        this.#settle(id, new Error("Malformed control response"));
        this.#log("Malformed control response");
      }
      return;
    }
    if (message.type === "control_cancel_request") {
      if (typeof message.request_id !== "string") {
        this.#log("Malformed control cancellation");
        return;
      }
      this.#incoming.get(message.request_id)?.abort(new Error("Peer cancelled control request"));
      return;
    }
    if (message.type === "control_request") {
      const id = typeof message.request_id === "string" && message.request_id ? message.request_id : undefined;
      if (!id || !object(message.request) || typeof message.request.subtype !== "string") {
        await this.#protocolError(id, "Malformed control request");
        return;
      }
      if (this.#incoming.has(id)) {
        await this.#protocolError(id, "Duplicate active control request ID");
        return;
      }
      const handler = Object.hasOwn(this.#options.controls, message.request.subtype)
        ? this.#options.controls[message.request.subtype]
        : undefined;
      if (!handler) {
        await this.#protocolError(id, `Unsupported control request: ${message.request.subtype}`);
        return;
      }
      if (this.#active.size >= this.#maxActive) {
        await this.#protocolError(id, "Too many active handlers");
        return;
      }
      const controller = new AbortController();
      this.#incoming.set(id, controller);
      this.#track(async () => {
        try {
          const response = await handler(message as unknown as ControlRequest, controller.signal);
          if (controller.signal.aborted) throw error(controller.signal.reason);
          await this.send({
            type: "control_response",
            response: { subtype: "success", request_id: id, ...(response === undefined ? {} : { response }) },
          });
        } catch (reason) {
          if (!this.#closed) await this.#protocolError(id, error(reason).message);
        } finally {
          this.#incoming.delete(id);
        }
      });
      return;
    }
    if (message.type === "user") {
      if (
        !object(message.message) ||
        message.message.role !== "user" ||
        !(typeof message.message.content === "string" || Array.isArray(message.message.content)) ||
        !(message.parent_tool_use_id === null || typeof message.parent_tool_use_id === "string")
      ) {
        this.#log("Malformed user message");
        return;
      }
      if (this.#active.size >= this.#maxActive) throw new Error("Too many active handlers");
      this.#track(() => this.#options.onUser(message as UserMessage, this.#lifetime.signal));
      return;
    }
    this.#log(`Unsupported input message type: ${String(message.type)}`);
  }

  #track(work: () => void | Promise<void>): void {
    const task = Promise.resolve()
      .then(work)
      .catch((reason) => {
        this.#log(error(reason).message);
        this.close(error(reason));
      })
      .finally(() => this.#active.delete(task));
    this.#active.add(task);
  }

  #write(frame: string): Promise<void> {
    if (this.#closed) return Promise.reject(this.#closed);
    const { output } = this.#options;
    if (output.destroyed || output.writableEnded) return Promise.reject(new Error("Transport output is not writable"));
    return new Promise((resolve, reject) => {
      let written = false;
      let drained = false;
      let settled = false;
      const finish = (reason?: Error) => {
        if (settled || (!reason && (!written || !drained))) return;
        settled = true;
        output.off("drain", onDrain);
        this.#lifetime.signal.removeEventListener("abort", onAbort);
        if (reason) reject(reason);
        else resolve();
      };
      const onDrain = () => {
        drained = true;
        finish();
      };
      const onAbort = () => finish(this.#closed ?? new Error("Transport closed"));
      output.once("drain", onDrain);
      this.#lifetime.signal.addEventListener("abort", onAbort, { once: true });
      try {
        const accepted = output.write(frame, (reason) => {
          written = true;
          finish(reason ?? undefined);
        });
        if (accepted) {
          drained = true;
          finish();
        }
      } catch (reason) {
        finish(error(reason));
      }
    });
  }
}
