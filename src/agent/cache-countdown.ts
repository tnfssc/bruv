import { visitDiskBackedBranch } from "../history/session-manager";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recordDiagnostic } from "../diagnostics.js";
import { subscribeProviderAttempts } from "./provider-attempts";

export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
export const CACHE_CALL_ENTRY = "bruv-cache-call";
export const CACHE_OBSERVATION_RECORDED = "cache_observation_recorded";
export const CACHE_CORRELATION_UNAVAILABLE = "cache_correlation_unavailable";
export const CACHE_HTTP_REJECTED = "http_rejected";
export const CACHE_OBSERVER_FAILED = "observer_failed";
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CacheSettings {
  ttlMs: number;
}
export interface CacheCall {
  timestamp: number;
  provider: string;
  model: string;
}
export interface CacheEstimate {
  state: "unknown" | "active" | "warning" | "urgent" | "expired";
  text: string;
  nextUpdateMs?: number;
}

export function cacheSettingsPath(): string {
  return join(homedir(), ".bruv", "cache-settings.json");
}
export function parseCacheSettings(value: unknown): CacheSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("settings must be an object");
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "cacheTtlMs"))
    throw new Error(`unknown setting: ${keys.find((key) => key !== "cacheTtlMs")}`);
  const ttlMs = (value as { cacheTtlMs?: unknown }).cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || (ttlMs as number) < MIN_TTL_MS || (ttlMs as number) > MAX_TTL_MS) {
    throw new Error("cacheTtlMs must be an integer from 60000 to 604800000");
  }
  return { ttlMs: ttlMs as number };
}
export async function loadCacheSettings(path = cacheSettingsPath()): Promise<CacheSettings> {
  try {
    return parseCacheSettings(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ttlMs: DEFAULT_CACHE_TTL_MS };
    throw new Error(`Invalid cache settings at ${path}: ${String(error)}`);
  }
}
export async function saveCacheSettings(settings: CacheSettings, path = cacheSettingsPath()): Promise<void> {
  const value = parseCacheSettings({ cacheTtlMs: settings.ttlMs });
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ cacheTtlMs: value.ttlMs }, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Parse a bounded duration. Treat bare numbers as minutes. */
export function parseCacheTtl(input: string): number {
  const match = input
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|day|days)?$/);
  if (!match) throw new Error("Use a duration such as 30m, 1h, or 1d");
  const amount = Number(match[1]);
  const unit = match[2] ?? "m";
  const multiplier = unit.startsWith("d") ? 86_400_000 : unit.startsWith("h") ? 3_600_000 : 60_000;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result) || result < MIN_TTL_MS || result > MAX_TTL_MS)
    throw new Error("TTL must be between 1 minute and 7 days");
  return result;
}
export function formatCacheTtl(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  return `${ms / 60_000}m`;
}
function validCall(value: unknown): value is CacheCall {
  const call = value as CacheCall;
  return (
    !!call &&
    Number.isFinite(call.timestamp) &&
    call.timestamp > 0 &&
    typeof call.provider === "string" &&
    !!call.provider &&
    typeof call.model === "string" &&
    !!call.model
  );
}

/**
 * This is only an estimate. A record means an HTTP response or successful final
 * message showed a provider request. It does not prove cache creation,
 * compatibility, or a hit.
 */
export class CacheCountdown {
  ttlMs = DEFAULT_CACHE_TTL_MS;
  private calls = new Map<string, number>();
  private listeners = new Set<() => void>();
  constructor(private now: () => number = Date.now) {}
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* optional UI observer */
      }
    }
  }
  setTtl(ttlMs: number) {
    if (this.ttlMs !== ttlMs) {
      this.ttlMs = ttlMs;
      this.changed();
    }
  }
  modelChanged() {
    this.changed();
  }
  invalidate() {
    this.calls.clear();
    this.changed();
  }
  restore(ctx: ExtensionContext) {
    this.calls.clear();
    if (!ctx.sessionManager?.getEntries) {
      this.changed();
      return;
    }
    const manager = ctx.sessionManager as typeof ctx.sessionManager & {
      getBranch?: () => ReturnType<typeof ctx.sessionManager.getEntries>;
    };
    const indexed = visitDiskBackedBranch(manager, (meta) => {
      if (meta.type !== "custom") return;
      // Newest-first: the latest shake excludes all earlier observations.
      if (meta.customType === "bruv-manual-shake") return false;
      if (meta.customType !== CACHE_CALL_ENTRY) return;
      const entry = manager.getEntry(meta.id);
      if (entry?.type === "custom" && validCall(entry.data)) {
        const key = `${entry.data.provider}/${entry.data.model}`;
        this.calls.set(key, Math.max(this.calls.get(key) ?? 0, entry.data.timestamp));
      }
    });
    if (indexed === undefined)
      for (const entry of manager.getBranch?.() ?? manager.getEntries()) {
        // A shake changes the serialized prompt prefix. Do not display a TTL for
        // the pre-shake request after resume; later observed calls repopulate it.
        if (entry.type === "custom" && entry.customType === "bruv-manual-shake") this.calls.clear();
        else if (entry.type === "custom" && entry.customType === CACHE_CALL_ENTRY && validCall(entry.data)) {
          const key = `${entry.data.provider}/${entry.data.model}`;
          this.calls.set(key, Math.max(this.calls.get(key) ?? 0, entry.data.timestamp));
        }
      }
    this.changed();
  }
  record(pi: ExtensionAPI, model: Pick<Model<Api>, "provider" | "id"> | undefined, timestamp = this.now()) {
    if (!model) return;
    const call = { timestamp, provider: model.provider, model: model.id };
    // Persist first. An append failure must not leave an in-memory estimate that
    // claims an observation which cannot survive resume.
    pi.appendEntry(CACHE_CALL_ENTRY, call);
    this.calls.set(`${call.provider}/${call.model}`, timestamp);
    this.changed();
  }
  estimate(ctx: Pick<ExtensionContext, "model">, now = this.now()): CacheEstimate {
    const model = ctx.model;
    const timestamp = model ? this.calls.get(`${model.provider}/${model.id}`) : undefined;
    if (timestamp === undefined) return { state: "unknown", text: "cache est ?" };
    const remaining = timestamp + this.ttlMs - now;
    if (remaining <= 0) return { state: "expired", text: "cache est expired" };
    const minutes = Math.max(1, Math.ceil(remaining / 60_000));
    const state = remaining <= 5 * 60_000 ? "urgent" : remaining <= 15 * 60_000 ? "warning" : "active";
    // Wake only when the visible minute or warning state can change.
    const nextUpdateMs = Math.max(1, remaining - (minutes - 1) * 60_000);
    return { state, text: `cache est ${minutes}m`, nextUpdateMs };
  }
}

type CacheModel = Pick<Model<Api>, "provider" | "id">;
type CacheAttempt = {
  operationId: string;
  model: CacheModel;
  startedAt: number;
};

/** Session-scoped evidence, separate from the durable observations and TTL setting. */
class CacheRequestObserver {
  private owner: object | undefined;
  private unsubscribe = () => {};
  private attempts = new Set<CacheAttempt>();
  // An HTTP response and assistant ending can describe the same request without
  // a shared token. Its terminal event must not be assigned to a newer request.
  private httpTerminalDebt = new Map<string, number>();

  constructor(
    private pi: ExtensionAPI,
    private countdown: CacheCountdown,
  ) {}

  startSession(ctx: ExtensionContext) {
    this.unsubscribe();
    this.countdown.restore(ctx);
    this.attempts.clear();
    this.httpTerminalDebt.clear();
    this.owner = ctx.sessionManager && typeof ctx.sessionManager === "object" ? ctx.sessionManager : undefined;
    if (this.owner) {
      this.unsubscribe = subscribeProviderAttempts(this.owner, (event) => {
        // Fetch dispatch alone does not prove provider acceptance.
        if (event.observedAt === "response") this.record(event.operationId, event.model, event.timestamp, "response");
      });
    }
  }

  stopSession() {
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.owner = undefined;
    this.attempts.clear();
    this.httpTerminalDebt.clear();
  }

  requestStarted(model: CacheModel | undefined) {
    if (!model) return;
    this.attempts.add({
      operationId: randomUUID(),
      model: { provider: model.provider, id: model.id },
      startedAt: Date.now(),
    });
  }

  httpResponse(status: number, model: CacheModel | undefined) {
    const attempt = this.takeAttempt(model);
    if (!attempt) return;
    // Even a rejected response has a trailing terminal event. When the SDK
    // omits identity, use the request snapshot to suppress that event.
    const responseModel = model ?? attempt.model;
    const key = this.modelKey(responseModel);
    this.httpTerminalDebt.set(key, (this.httpTerminalDebt.get(key) ?? 0) + 1);
    if (!Number.isInteger(status) || status < 200 || status >= 300) {
      this.diagnostic({
        component: "cache",
        code: CACHE_HTTP_REJECTED,
        outcome: "noop",
        operationId: attempt.operationId,
        dispatch: "response",
        ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
      });
      return;
    }
    this.record(attempt.operationId, responseModel, Date.now(), "response");
  }

  assistantEnded(model: CacheModel | undefined, stopReason: string) {
    const attempt = this.takeTerminalAttempt(model);
    if (!attempt || stopReason === "error" || stopReason === "aborted") return;
    // Successful terminal events cover WebSockets. Request start is conservative:
    // streaming time is never added to the displayed TTL.
    this.record(attempt.operationId, model ?? attempt.model, attempt.startedAt, "initiated");
  }

  private modelKey(model: CacheModel) {
    return `${model.provider}/${model.id}`;
  }

  private candidates(model: CacheModel) {
    return [...this.attempts].filter(
      (attempt) => attempt.model.provider === model.provider && attempt.model.id === model.id,
    );
  }

  private block(blocked: CacheAttempt[]) {
    for (const attempt of blocked) this.attempts.delete(attempt);
    this.diagnostic({
      component: "cache",
      code: CACHE_CORRELATION_UNAVAILABLE,
      outcome: "blocked",
      dispatch: "unknown",
      count: blocked.length,
    });
  }

  private takeAttempt(model: CacheModel | undefined): CacheAttempt | undefined {
    // Model-less HTTP responses require exactly one outstanding snapshot.
    // Overlap must discard every candidate, never guess by insertion order.
    const matches = model ? this.candidates(model) : [...this.attempts];
    if (matches.length === 1) {
      const attempt = matches[0];
      this.attempts.delete(attempt);
      return attempt;
    }
    if (matches.length > 1) this.block(matches);
    return undefined;
  }

  private takeTerminalAttempt(model: CacheModel | undefined): CacheAttempt | undefined {
    if (model) {
      const key = this.modelKey(model);
      const debt = this.httpTerminalDebt.get(key) ?? 0;
      if (debt > 0) {
        if (debt === 1) this.httpTerminalDebt.delete(key);
        else this.httpTerminalDebt.set(key, debt - 1);
        // An overlapping request for the same model makes this ending ambiguous.
        // Drop it as well rather than consuming the newer request's evidence.
        const overlapping = this.candidates(model);
        if (overlapping.length > 0) this.block(overlapping);
        return undefined;
      }
    }
    return this.takeAttempt(model);
  }

  private diagnostic(input: Parameters<typeof recordDiagnostic>[1]) {
    if (this.owner) recordDiagnostic(this.owner, input);
  }

  private record(operationId: string, model: CacheModel, timestamp: number, dispatch: "response" | "initiated") {
    try {
      this.countdown.record(this.pi, model, timestamp);
      this.diagnostic({
        component: "cache",
        code: CACHE_OBSERVATION_RECORDED,
        outcome: "success",
        operationId,
        dispatch,
      });
    } catch {
      this.diagnostic({
        component: "observer",
        code: CACHE_OBSERVER_FAILED,
        outcome: "failed",
        operationId,
        dispatch,
      });
    }
  }
}

export function registerCacheCountdown(pi: ExtensionAPI, countdown: CacheCountdown, path = cacheSettingsPath()): void {
  let loadError: Error | undefined;
  const ready = loadCacheSettings(path)
    .then((settings) => countdown.setTtl(settings.ttlMs))
    .catch((error) => {
      loadError = error instanceof Error ? error : new Error(String(error));
    });
  const observer = new CacheRequestObserver(pi, countdown);
  pi.on("session_start", async (_event, ctx) => {
    observer.startSession(ctx);
    await ready;
    if (loadError)
      ctx.ui?.notify?.(
        `${loadError.message}. The file was left unchanged; using the default cache estimate.`,
        "warning",
      );
  });
  pi.on("session_shutdown", () => observer.stopSession());
  pi.on("before_provider_request", (_event, ctx) => observer.requestStarted(ctx.model));
  pi.on("after_provider_response", (event) => {
    const response = event as typeof event & { model?: CacheModel };
    observer.httpResponse(response.status, response.model);
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const message = event.message as typeof event.message & { provider?: string; model?: string };
    const model =
      typeof message.provider === "string" && typeof message.model === "string"
        ? { provider: message.provider, id: message.model }
        : undefined;
    observer.assistantEnded(model, event.message.stopReason);
  });
  pi.on("model_select", () => countdown.modelChanged());
  pi.registerCommand("cache-ttl", {
    description: "Show or set the informational provider-cache TTL estimate",
    handler: async (args, ctx) => {
      await ready;
      const value = args.trim();
      if (!value) {
        ctx.ui.notify(
          "Cache TTL estimate: " +
            formatCacheTtl(countdown.ttlMs) +
            ". Informational only; not a provider cache guarantee.",
          "info",
        );
        return;
      }
      try {
        const ttlMs = parseCacheTtl(value);
        await saveCacheSettings({ ttlMs }, path);
        countdown.setTtl(ttlMs);
        loadError = undefined;
        ctx.ui.notify(
          "Cache TTL estimate set to " +
            formatCacheTtl(ttlMs) +
            ". This does not guarantee provider cache retention or hits.",
          "info",
        );
      } catch (error) {
        ctx.ui.notify(`Invalid cache TTL: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
