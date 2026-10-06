/** Opt-in, instance-only interaction tracing. No output or promise continuations in timed code. */
export interface ActionMethodObservation {
  target: object;
  method: string;
  name: string;
}

export interface ActionProfilerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TerminalActionProfilerOptions {
  capacity?: number;
  /** Monotonic milliseconds; use the same clock as attachTerminalProfiler for joined traces. */
  now?: () => number;
  scheduler?: ActionProfilerScheduler;
  /** Default 4ms; null disables. Sampling is not a frame CPU measurement. */
  heartbeatIntervalMs?: number | null;
  observe?: readonly ActionMethodObservation[];
  /** Caller-owned workload/content fingerprints, fixture version, source revision, etc. */
  traceInfo?: Readonly<Record<string, string>>;
}

export interface ActionSpanSample {
  id: number;
  parentId: number | null;
  rootId: number;
  label: string;
  kind: "action" | "input" | "method" | "request" | "frame";
  startedAtMs: number;
  endedAtMs: number;
  syncDurationMs: number;
  syncExclusiveMs: number;
  /** Only a synchronous throw. Promise rejection/settlement is deliberately not observed. */
  syncThrew: boolean;
}

export interface ActionFirstFrameLink {
  rootSpanId: number;
  label: string;
  actionStartedAtMs: number;
  actionSyncEndedAtMs: number | null;
  actionStartToFirstFrameEntryMs: number;
  /** null if frame entered before the synchronous action returned. Not CPU time. */
  actionSyncEndToFirstFrameEntryMs: number | null;
}

export interface ActionFrameEntrySample {
  id: number;
  enteredAtMs: number;
  requestCount: number;
  firstRequestAtMs: number | null;
  firstRequestSyncEndedAtMs: number | null;
  /** Latencies include intervening work, not just idle scheduler waiting. */
  firstRequestToFrameEntryMs: number | null;
  firstRequestSyncEndToFrameEntryMs: number | null;
  firstFrameForActions: ActionFirstFrameLink[];
  droppedActionLinks: number;
  syncThrew: boolean;
}

export interface ActionHeartbeatSample {
  expectedAtMs: number;
  observedAtMs: number;
  previousObservedAtMs: number;
  intervalMs: number;
  eventLoopDelayMs: number;
  elapsedSincePreviousMs: number;
}

export interface TerminalActionProfilerSnapshot {
  schemaVersion: 1;
  clock: "performance.now" | "injected-monotonic";
  traceInfo: Record<string, string>;
  heartbeatIntervalMs: number | null;
  spans: ActionSpanSample[];
  frameEntries: ActionFrameEntrySample[];
  heartbeats: ActionHeartbeatSample[];
  /** Spans are stored in completion order; IDs/parentId/start/end reconstruct nesting. */
  totalSpans: number;
  droppedSpans: number;
  totalFrameEntries: number;
  droppedFrameEntries: number;
  totalHeartbeats: number;
  droppedHeartbeats: number;
  droppedPendingActionLinks: number;
}

export interface TerminalActionProfiler {
  /** Returns the exact value/promise, or throws the original error. Scope ends on synchronous return. */
  runAction<T>(label: string, fn: () => T): T;
  snapshot(): TerminalActionProfilerSnapshot;
  /** Clears retained evidence and pending associations, not monotonic trace IDs or timer cadence. */
  clear(): void;
  dispose(): void;
}

type Method = (...args: unknown[]) => unknown;
type Instance = Record<string, unknown>;
const attached = new WeakSet<object>();

class Ring<T> {
  private items: (T | undefined)[];
  private head = 0;
  private size = 0;
  total = 0;
  constructor(private capacity: number) {
    this.items = new Array(capacity);
  }
  push(item: T) {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    this.total++;
  }
  values(): T[] {
    return Array.from({ length: this.size }, (_, i) => {
      // biome-ignore lint/style/noNonNullAssertion: retained slots are populated.
      return this.items[(this.head - this.size + i + this.capacity) % this.capacity]!;
    });
  }
  get dropped() {
    return this.total - this.size;
  }
  clear() {
    this.items.fill(undefined);
    this.head = this.size = this.total = 0;
  }
}

interface ActiveSpan {
  sample: ActionSpanSample;
  childMs: number;
  root: ActiveSpan;
  firstFrame?: { frame: ActionFrameEntrySample; link: ActionFirstFrameLink };
}
interface PendingRequest {
  at: number;
  endedAt: number | null;
  count: number;
  roots: Map<number, ActiveSpan>;
  droppedLinks: number;
  frame?: ActionFrameEntrySample;
}

/**
 * Compose with attachTerminalProfiler on the SAME concrete Pi renderer, in either
 * attachment order. Dispose in reverse order for full descriptor restoration.
 * doRender timing alone cannot exclude a submission/event/mutation stall.
 * Async methods contribute ONLY their synchronous prefix; use observe/runAction
 * again for deferred callbacks. No async context is implicitly propagated.
 * Instrumentation overhead is included. No input, method args or output retained.
 */
export function attachTerminalActionProfiler(
  renderer: object,
  options: TerminalActionProfilerOptions = {},
): TerminalActionProfiler {
  const capacity = options.capacity ?? 2048;
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new Error("Action profiler capacity must be a positive safe integer");
  const interval = options.heartbeatIntervalMs === undefined ? 4 : options.heartbeatIntervalMs;
  if (interval !== null && (!Number.isFinite(interval) || interval <= 0))
    throw new Error("Heartbeat interval must be positive or null");
  const target = renderer as Instance;
  if (attached.has(renderer)) throw new Error("Renderer already has an action profiler attached");
  for (const method of ["doRender", "handleTerminalInput", "requestRender"]) {
    if (typeof target[method] !== "function")
      throw new Error(`Action profiler requires concrete renderer method: ${method}`);
  }
  const now = options.now ?? (() => performance.now());
  const scheduler = options.scheduler ?? {
    setTimeout(callback: () => void, delayMs: number) {
      const timer = setTimeout(callback, delayMs);
      timer.unref?.();
      return timer;
    },
    clearTimeout(handle: unknown) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
  const spans = new Ring<ActionSpanSample>(capacity);
  const frames = new Ring<ActionFrameEntrySample>(capacity);
  const heartbeats = new Ring<ActionHeartbeatSample>(capacity);
  const traceInfo = { ...options.traceInfo };
  const stack: ActiveSpan[] = [];
  const restores: (() => void)[] = [];
  const patched = new Map<object, Set<string>>();
  let spanSequence = 0,
    frameSequence = 0,
    droppedPendingActionLinks = 0;
  let pending: PendingRequest | undefined;
  let disposed = false;
  let timer: unknown;
  let timerPending = false;

  function measure<T>(label: string, kind: ActionSpanSample["kind"], fn: () => T): T {
    if (disposed) return fn();
    const parent = stack.at(-1);
    const id = ++spanSequence;
    const startedAtMs = now();
    const sample: ActionSpanSample = {
      id,
      parentId: parent?.sample.id ?? null,
      rootId: parent?.root.sample.id ?? id,
      label,
      kind,
      startedAtMs,
      endedAtMs: startedAtMs,
      syncDurationMs: 0,
      syncExclusiveMs: 0,
      syncThrew: false,
    };
    const active = { sample, childMs: 0 } as ActiveSpan;
    active.root = parent?.root ?? active;
    stack.push(active);
    try {
      return fn();
    } catch (error) {
      sample.syncThrew = true;
      throw error;
    } finally {
      sample.endedAtMs = now();
      sample.syncDurationMs = sample.endedAtMs - startedAtMs;
      sample.syncExclusiveMs = sample.syncDurationMs - active.childMs;
      stack.pop();
      if (parent) parent.childMs += sample.syncDurationMs;
      if (active.firstFrame) {
        const { frame, link } = active.firstFrame;
        link.actionSyncEndedAtMs = sample.endedAtMs;
        link.actionSyncEndToFirstFrameEntryMs =
          frame.enteredAtMs >= sample.endedAtMs ? frame.enteredAtMs - sample.endedAtMs : null;
      }
      spans.push(sample);
    }
  }

  function patch(object: object, method: string, wrap: (original: Method) => Method) {
    const instance = object as Instance;
    const original = instance[method];
    if (typeof original !== "function") throw new Error(`Observed action method is missing: ${method}`);
    let keys = patched.get(object);
    if (!keys) {
      keys = new Set();
      patched.set(object, keys);
    }
    if (keys.has(method)) throw new Error(`Action method observed twice: ${method}`);
    keys.add(method);
    const descriptor = Object.getOwnPropertyDescriptor(instance, method);
    const wrapper = wrap(original as Method);
    Object.defineProperty(instance, method, {
      configurable: true,
      writable: true,
      enumerable: descriptor?.enumerable ?? false,
      value: wrapper,
    });
    restores.push(() => {
      if (instance[method] !== wrapper) return;
      if (descriptor) Object.defineProperty(instance, method, descriptor);
      else delete instance[method];
    });
  }

  function timed(name: string, kind: ActionSpanSample["kind"], original: Method): Method {
    return function (this: unknown, ...args: unknown[]) {
      return measure(name, kind, () => original.apply(this, args));
    };
  }

  function request(original: Method, name: string): Method {
    return function (this: Instance, ...args: unknown[]) {
      if (disposed || this.stopped) return original.apply(this, args);
      // Capture caller root BEFORE the request span itself becomes a root.
      const root = stack.at(-1)?.root;
      pending ??= {
        at: now(),
        endedAt: null,
        count: 0,
        roots: new Map(),
        droppedLinks: 0,
      };
      const record: PendingRequest = pending;
      const first = record.count++ === 0;
      if (root && !root.firstFrame && !record.roots.has(root.sample.id)) {
        if (record.roots.size < capacity) record.roots.set(root.sample.id, root);
        else {
          record.droppedLinks++;
          droppedPendingActionLinks++;
        }
      }
      try {
        return measure(name, "request", () => original.apply(this, args));
      } finally {
        if (first) {
          record.endedAt = now();
          if (record.frame) {
            record.frame.firstRequestSyncEndedAtMs = record.endedAt;
            record.frame.firstRequestSyncEndToFrameEntryMs =
              record.frame.enteredAtMs >= record.endedAt ? record.frame.enteredAtMs - record.endedAt : null;
          }
        }
      }
    };
  }

  function frame(original: Method): Method {
    return function (this: Instance, ...args: unknown[]) {
      if (disposed || this.stopped || (this.mode === "fullscreen" && this.altScreenActive === false))
        return original.apply(this, args);
      const enteredAtMs = now();
      const record = pending;
      pending = undefined;
      const sample: ActionFrameEntrySample = {
        id: ++frameSequence,
        enteredAtMs,
        requestCount: record?.count ?? 0,
        firstRequestAtMs: record?.at ?? null,
        firstRequestSyncEndedAtMs: record?.endedAt ?? null,
        firstRequestToFrameEntryMs: record ? enteredAtMs - record.at : null,
        firstRequestSyncEndToFrameEntryMs: record?.endedAt != null ? enteredAtMs - record.endedAt : null,
        firstFrameForActions: [],
        droppedActionLinks: record?.droppedLinks ?? 0,
        syncThrew: false,
      };
      if (record) {
        record.frame = sample;
        for (const root of record.roots.values()) {
          if (root.firstFrame) continue;
          const ended = stack.includes(root) ? null : root.sample.endedAtMs;
          const link: ActionFirstFrameLink = {
            rootSpanId: root.sample.id,
            label: root.sample.label,
            actionStartedAtMs: root.sample.startedAtMs,
            actionSyncEndedAtMs: ended,
            actionStartToFirstFrameEntryMs: enteredAtMs - root.sample.startedAtMs,
            actionSyncEndToFirstFrameEntryMs: ended === null ? null : enteredAtMs - ended,
          };
          root.firstFrame = { frame: sample, link };
          sample.firstFrameForActions.push(link);
        }
      }
      try {
        return measure("renderer.doRender", "frame", () => original.apply(this, args));
      } catch (error) {
        sample.syncThrew = true;
        throw error;
      } finally {
        frames.push(sample);
      }
    };
  }

  function armHeartbeat(previous: number) {
    if (disposed || interval === null) return;
    const expected = previous + interval;
    timer = scheduler.setTimeout(() => {
      timerPending = false;
      if (disposed) return;
      const observed = now();
      heartbeats.push({
        expectedAtMs: expected,
        observedAtMs: observed,
        previousObservedAtMs: previous,
        intervalMs: interval,
        eventLoopDelayMs: Math.max(0, observed - expected),
        elapsedSincePreviousMs: observed - previous,
      });
      // Fixed interval, rearmed from actual observation: no catch-up storm after a stall.
      armHeartbeat(observed);
    }, interval);
    timerPending = true;
  }

  const profiler: TerminalActionProfiler = {
    runAction(label, fn) {
      return measure(label, "action", fn);
    },
    snapshot() {
      return {
        schemaVersion: 1,
        clock: options.now ? "injected-monotonic" : "performance.now",
        traceInfo: { ...traceInfo },
        heartbeatIntervalMs: interval,
        spans: spans.values().map((s) => ({ ...s })),
        frameEntries: frames
          .values()
          .map((f) => ({ ...f, firstFrameForActions: f.firstFrameForActions.map((link) => ({ ...link })) })),
        heartbeats: heartbeats.values().map((h) => ({ ...h })),
        totalSpans: spans.total,
        droppedSpans: spans.dropped,
        totalFrameEntries: frames.total,
        droppedFrameEntries: frames.dropped,
        totalHeartbeats: heartbeats.total,
        droppedHeartbeats: heartbeats.dropped,
        droppedPendingActionLinks,
      };
    },
    clear() {
      spans.clear();
      frames.clear();
      heartbeats.clear();
      pending = undefined;
      droppedPendingActionLinks = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timerPending) scheduler.clearTimeout(timer);
      timerPending = false;
      for (const restore of restores.reverse()) restore();
      attached.delete(renderer);
      pending = undefined;
    },
  };
  attached.add(renderer);
  try {
    patch(renderer, "handleTerminalInput", (original) => timed("renderer.handleTerminalInput", "input", original));
    patch(renderer, "requestRender", (original) => request(original, "renderer.requestRender"));
    if (typeof target.requestImmediateRender === "function")
      patch(renderer, "requestImmediateRender", (original) => request(original, "renderer.requestImmediateRender"));
    patch(renderer, "doRender", frame);
    for (const entry of options.observe ?? [])
      patch(entry.target, entry.method, (original) => timed(entry.name, "method", original));
    armHeartbeat(now());
  } catch (error) {
    profiler.dispose();
    throw error;
  }
  return profiler;
}
