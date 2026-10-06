import type { Terminal } from "@earendil-works/pi-tui";

export interface ObservedTerminalMethod {
  target: object;
  method: string;
  name: string;
}

export interface TerminalProfilerOptions {
  /** Maximum retained frames (default 2048). Oldest frames are overwritten. */
  capacity?: number;
  /** Optional fixture/component methods; exclusive spans, only while a frame runs. */
  observe?: ObservedTerminalMethod[];
  /** Monotonic milliseconds; injectable for deterministic tests. */
  now?: () => number;
}

export interface TerminalFrameSample {
  id: number;
  startedAtMs: number;
  /** Synchronous doRender entry to return/throw, including layout, diff and write. */
  durationMs: number;
  failed: boolean;
  requestCount: number;
  requestDelayMs: number | null;
  inputCount: number;
  inputDelayMs: number | null;
  /** Attempted Terminal.write calls and UTF-8 argument bytes, not flushed output. */
  writeCount: number;
  outputBytes: number;
  /** Exclusive time in observable instance methods, NOT complete pipeline stages. */
  phasesMs: Record<string, number>;
  /** Includes inline/imported layout/diff work that instance wrappers cannot isolate. */
  unattributedMs: number;
}

export interface TerminalProfilerSnapshot {
  frames: TerminalFrameSample[];
  totalFrames: number;
  droppedFrames: number;
  outputBytes: number;
  writeCount: number;
  outsideFrameOutputBytes: number;
  outsideFrameWriteCount: number;
}

export interface TerminalProfiler {
  /** Detached, chronological samples. Does not expose the internal ring. */
  snapshot(): TerminalProfilerSnapshot;
  /** Reset samples, counters and pending request/input associations. */
  clear(): void;
  /** Idempotent; restores original own descriptors or removes temporary overrides. */
  dispose(): void;
}

type Method = (...args: unknown[]) => unknown;
type Instance = Record<string, unknown>;
const attached = new WeakSet<object>();

// Pi 1.0.3: fullscreen renderLayoutFrame is imported and its diff is inline.
// Regular mode's render(width) is a usable whole-document rendering boundary.
// These shared helpers are observable; none alone represents a complete diff.
const phaseMethods = [
  "render",
  "compositeOverlays",
  "compositeScrollToEndIndicator",
  "compositeFlashes",
  "refreshSearch",
  "applySearchHighlights",
  "applySelection",
  "extractCursorPosition",
  "applyLineResets",
  "prepareKittyScreen",
  "deleteKittyImages",
] as const;

/**
 * Opt-in Pi 1.0.3 instance instrumentation (regular and fullscreen).
 * Attach to the concrete renderer, not a host/facade. No prototype/global patches.
 * No async wrapper: the original methods' return values and throws are preserved.
 * Times include instrumentation overhead, but not terminal flush/paint/backpressure
 * after write returns. Bytes only cover Terminal.write, not helpers that bypass it.
 * Input starts at handleTerminalInput (after stdin decoding),
 * and is associated only when that dispatch calls a render request entrypoint.
 * Delays run to frame ENTRY, never count toward synchronous duration.
 */
export function attachTerminalProfiler(
  tui: { terminal: Terminal; requestRender(force?: boolean): void },
  options: TerminalProfilerOptions = {},
): TerminalProfiler {
  const capacity = options.capacity ?? 2048;
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("Profiler capacity must be a positive safe integer");
  }
  const target = tui as unknown as Instance;
  const terminal = tui.terminal as unknown as Instance;
  if (typeof target.doRender !== "function" || typeof terminal.write !== "function") {
    throw new Error("Profiler requires a concrete synchronous Pi renderer and Terminal.write");
  }
  if (attached.has(target) || attached.has(terminal)) {
    throw new Error("Renderer or terminal already has a profiler attached");
  }
  const now = options.now ?? (() => performance.now());
  const ring: (TerminalFrameSample | undefined)[] = new Array(capacity);
  let size = 0,
    head = 0,
    sequence = 0,
    totalFrames = 0;
  let outputBytes = 0,
    writeCount = 0;
  let outsideFrameOutputBytes = 0,
    outsideFrameWriteCount = 0;
  let disposed = false;
  let frame: TerminalFrameSample | undefined;
  let pendingRequestAt: number | undefined;
  let pendingRequestCount = 0;
  let pendingInputAt: number | undefined;
  let pendingInputCount = 0;
  let inputSequence = 0,
    lastAssociatedInput = 0;
  let input: { id: number; at: number } | undefined;
  const stack: { childMs: number }[] = [];
  const restores: (() => void)[] = [];

  function patch(object: Instance, key: string, wrap: (original: Method) => Method) {
    const original = object[key];
    if (typeof original !== "function") return;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const wrapper = wrap(original as Method);
    Object.defineProperty(object, key, {
      configurable: true,
      writable: true,
      enumerable: descriptor?.enumerable ?? false,
      value: wrapper,
    });
    restores.push(() => {
      // Do not overwrite a subsequent adapter's method replacement.
      if (object[key] !== wrapper) return;
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else delete object[key];
    });
  }

  function resetPending() {
    pendingRequestAt = undefined;
    pendingRequestCount = 0;
    pendingInputAt = undefined;
    pendingInputCount = 0;
    lastAssociatedInput = 0;
  }

  function phase(name: string, original: Method): Method {
    return function (this: Instance, ...args: unknown[]) {
      if (disposed || !frame) return original.apply(this, args);
      const active = frame;
      const entry = { childMs: 0 };
      stack.push(entry);
      const start = now();
      try {
        return original.apply(this, args);
      } finally {
        const elapsed = now() - start;
        stack.pop();
        const parent = stack.at(-1);
        if (parent) parent.childMs += elapsed;
        active.phasesMs[name] = (active.phasesMs[name] ?? 0) + elapsed - entry.childMs;
      }
    };
  }

  const profiler: TerminalProfiler = {
    snapshot() {
      const frames = Array.from({ length: size }, (_, i) => {
        // biome-ignore lint/style/noNonNullAssertion: every retained ring slot is populated.
        const sample = ring[(head - size + i + capacity) % capacity]!;
        return { ...sample, phasesMs: { ...sample.phasesMs } };
      });
      return {
        frames,
        totalFrames,
        droppedFrames: totalFrames - size,
        outputBytes,
        writeCount,
        outsideFrameOutputBytes,
        outsideFrameWriteCount,
      };
    },
    clear() {
      ring.fill(undefined);
      size = 0;
      head = 0;
      totalFrames = 0;
      outputBytes = 0;
      writeCount = 0;
      outsideFrameOutputBytes = 0;
      outsideFrameWriteCount = 0;
      resetPending();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const restore of restores.reverse()) restore();
      attached.delete(target);
      attached.delete(terminal);
      resetPending();
    },
  };

  attached.add(target);
  attached.add(terminal);
  try {
    patch(
      target,
      "doRender",
      (original) =>
        function (this: Instance, ...args: unknown[]) {
          if (disposed || frame || this.stopped || (this.mode === "fullscreen" && this.altScreenActive === false)) {
            return original.apply(this, args);
          }
          const start = now();
          const active: TerminalFrameSample = {
            id: ++sequence,
            startedAtMs: start,
            durationMs: 0,
            failed: false,
            requestCount: pendingRequestCount,
            requestDelayMs: pendingRequestAt === undefined ? null : start - pendingRequestAt,
            inputCount: pendingInputCount,
            inputDelayMs: pendingInputAt === undefined ? null : start - pendingInputAt,
            writeCount: 0,
            outputBytes: 0,
            phasesMs: {},
            unattributedMs: 0,
          };
          resetPending();
          frame = active;
          try {
            return original.apply(this, args);
          } catch (error) {
            active.failed = true;
            throw error;
          } finally {
            active.durationMs = now() - start;
            active.unattributedMs = Math.max(
              0,
              active.durationMs - Object.values(active.phasesMs).reduce((a, b) => a + b, 0),
            );
            frame = undefined;
            ring[head] = active;
            head = (head + 1) % capacity;
            size = Math.min(size + 1, capacity);
            totalFrames++;
          }
        },
    );
    for (const name of phaseMethods) patch(target, name, (original) => phase(name, original));
    for (const entry of options.observe ?? []) {
      if (typeof (entry.target as Instance)[entry.method] !== "function")
        throw new Error(`Observed phase method is missing: ${entry.name}`);
      patch(entry.target as Instance, entry.method, (original) => phase(entry.name, original));
    }
    patch(terminal, "write", (original) => {
      const timed = phase("terminal.write", original);
      return function (this: Instance, ...args: unknown[]) {
        if (disposed) return original.apply(this, args);
        const data = args[0] as string;
        // Count attempted writes (also if Terminal.write throws), not flushed bytes.
        const bytes = Buffer.byteLength(data, "utf8");
        outputBytes += bytes;
        writeCount++;
        if (frame) {
          frame.outputBytes += bytes;
          frame.writeCount++;
        } else {
          outsideFrameOutputBytes += bytes;
          outsideFrameWriteCount++;
        }
        return timed.apply(this, args);
      };
    });
    for (const name of ["requestRender", "requestImmediateRender"]) {
      patch(
        target,
        name,
        (original) =>
          function (this: Instance, ...args: unknown[]) {
            if (!disposed && !this.stopped) {
              pendingRequestAt ??= now();
              pendingRequestCount++;
              if (input && input.id !== lastAssociatedInput) {
                pendingInputAt ??= input.at;
                pendingInputCount++;
                lastAssociatedInput = input.id;
              }
            }
            return original.apply(this, args);
          },
      );
    }
    patch(
      target,
      "handleTerminalInput",
      (original) =>
        function (this: Instance, ...args: unknown[]) {
          if (disposed) return original.apply(this, args);
          const previous = input;
          input = { id: ++inputSequence, at: now() };
          try {
            return original.apply(this, args);
          } finally {
            input = previous;
          }
        },
    );
  } catch (error) {
    profiler.dispose();
    throw error;
  }
  return profiler;
}
