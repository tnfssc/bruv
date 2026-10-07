import { getLatestDiskBackedCustomEntry } from "../history/session-manager";
import { restoreLeaf } from "../session/restore-leaf";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AsyncLocalStorage } from "node:async_hooks";
import { lazyStream, normalizeContext, type Context, type Model } from "@earendil-works/pi-ai";
import { recordDiagnostic } from "../diagnostics.js";

export const NATIVE_FAST_CHILD_ENV = "BRUV_SUBAGENT_NATIVE_FAST";
export const NATIVE_FAST_ENTRY = "bruv-native-fast-mode";
const ENTRY_VERSION = 2;
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const standardTierScope = new AsyncLocalStorage<boolean>();
const volatileOptOuts = new WeakMap<object, Set<string>>();

function settingScope(sessionId: string, provider: string, model: string): string {
  return `${sessionId}\0${provider}\0${model}`;
}

export const FAST_REFUSED_INVALID_COMMAND = "request_blocked";
export const FAST_REFUSED_NO_MODEL = "state_invalid";
export const FAST_REFUSED_UNSUPPORTED = "payload_incompatible";
export const FAST_REFUSED_COMPATIBILITY = "coverage_incomplete";
export const FAST_REFUSED_AUTH = "identity_stale";
export const FAST_CANCELLED_COST = "caller_aborted";
export const FAST_REFUSED_STALE = "identity_stale";
export const FAST_CHECKPOINT_PERSIST_FAILED = "state_write_failed";
export const FAST_GUARD_AMBIGUOUS_AUTHORIZATION = "state_invalid";
export const FAST_GUARD_BLOCKED_AUTHORIZATION = "request_blocked";
export const FAST_GUARD_MISSING_TIER = "state_invalid";
export const FAST_GUARD_INVALID_PAYLOAD = "payload_incompatible";
export const FAST_GUARD_MODEL_MISMATCH = "identity_stale";
export const FAST_GUARD_TIER_MUTATION = "payload_incompatible";
export const FAST_GUARD_IDENTITY_MISMATCH = "identity_stale";
export const FAST_GUARD_UNSUPPORTED_ENDPOINT = "payload_incompatible";

type OperationId = `${string}-${string}-${string}-${string}-${string}`;
function fastDiagnostic(
  manager: object,
  code: string,
  outcome: "success" | "failed" | "fallback" | "blocked" | "cancelled" | "noop",
  operationId?: OperationId,
  cancellation?: "caller" | "provider" | "timeout" | "shutdown" | "safety",
): void {
  const sessionManager = manager as ExtensionContext["sessionManager"];
  const priorLeaf = (sessionManager as { getLeafId?: () => string | null }).getLeafId?.();
  try {
    recordDiagnostic(sessionManager, {
      component: "fast",
      code,
      outcome,
      ...(operationId ? { operationId } : {}),
      dispatch: "none",
      ...(cancellation ? { cancellation } : {}),
    });
  } catch {
    // Diagnostics must not weaken or replace the request guard.
  } finally {
    restoreLeaf(sessionManager, priorLeaf);
  }
}
function commandDiagnostic(
  ctx: ExtensionContext,
  code: string,
  outcome: "success" | "failed" | "blocked" | "cancelled" | "noop",
  operationId: OperationId,
  cancellation?: "caller" | "provider" | "timeout" | "shutdown" | "safety",
): void {
  fastDiagnostic(ctx.sessionManager as object, code, outcome, operationId, cancellation);
}

/** Keep only this async compaction request at standard price. AsyncLocalStorage
 * stops overlapping requests in the same session from inheriting its tier. */
export async function withStandardProviderTier<T>(run: () => Promise<T>): Promise<T> {
  return standardTierScope.run(true, run);
}

// Exact model aliases evidenced by the provider documentation/source snapshot.
// Do not broaden these with family-prefix matching: similarly named mini/Spark
// models do not inherit native fast-mode support.
type Setting = {
  version: 2;
  oauth: boolean;
  sessionId: string;
  provider: string;
  model: string;
  enabled: boolean;
  costAcknowledged: boolean;
  timestamp: number;
};

type Payload = Record<string, unknown>;
function record(value: unknown): value is Payload {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function normalizedUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
function officialSurface(model: Pick<Model<any>, "provider" | "api" | "baseUrl">): boolean {
  return (
    (model.provider === "openai" &&
      model.api === "openai-responses" &&
      normalizedUrl(model.baseUrl) === OPENAI_BASE_URL) ||
    (model.provider === "openai-codex" &&
      model.api === "openai-codex-responses" &&
      normalizedUrl(model.baseUrl) === CODEX_BASE_URL)
  );
}
function leafId(ctx: ExtensionContext): string | null {
  return (ctx.sessionManager as { getLeafId?: () => string | null }).getLeafId?.() ?? null;
}
function branch(ctx: ExtensionContext): any[] {
  const manager = ctx.sessionManager as { getBranch?: () => any[]; getEntries?: () => any[] };
  return manager.getBranch?.() ?? manager.getEntries?.() ?? [];
}
const MAX_ID_LENGTH = 256;
function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}
function setting(value: unknown): value is Setting {
  if (!record(value)) return false;
  return (
    value.version === ENTRY_VERSION &&
    typeof value.oauth === "boolean" &&
    boundedId(value.sessionId) &&
    boundedId(value.provider) &&
    boundedId(value.model) &&
    typeof value.enabled === "boolean" &&
    typeof value.costAcknowledged === "boolean" &&
    value.costAcknowledged === value.enabled &&
    typeof value.timestamp === "number" &&
    Number.isSafeInteger(value.timestamp) &&
    value.timestamp >= 0
  );
}
type SettingResolution = { kind: "valid"; value: Setting } | { kind: "invalid" } | { kind: "absent" };
function resolveSetting(
  ctx: ExtensionContext,
  model = ctx.model,
  sessionId = ctx.sessionManager.getSessionId(),
): SettingResolution {
  if (!model) return { kind: "absent" };
  if (volatileOptOuts.get(ctx.sessionManager as object)?.has(settingScope(sessionId, model.provider, model.id))) {
    return {
      kind: "valid",
      value: {
        version: ENTRY_VERSION,
        oauth: false,
        sessionId,
        provider: model.provider,
        model: model.id,
        enabled: false,
        costAcknowledged: false,
        timestamp: 0,
      },
    };
  }
  const latest = getLatestDiskBackedCustomEntry(ctx.sessionManager, NATIVE_FAST_ENTRY, (entry) => {
    // Malformed identity is authoritative; well-formed records for another
    // session/model may be skipped, just as in the native branch scan below.
    const data = entry.data;
    return (
      !record(data) ||
      !boundedId(data.sessionId) ||
      !boundedId(data.provider) ||
      !boundedId(data.model) ||
      (data.sessionId === sessionId && data.provider === model.provider && data.model === model.id)
    );
  });
  const entries = latest === undefined ? branch(ctx) : latest ? [latest] : [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== NATIVE_FAST_ENTRY) continue;
    if (!record(entry.data)) return { kind: "invalid" };
    // If identity itself is corrupt it cannot safely be assigned to some other
    // scope. A well-formed identity for another scope may be skipped.
    if (!boundedId(entry.data.sessionId) || !boundedId(entry.data.provider) || !boundedId(entry.data.model))
      return { kind: "invalid" };
    // Identity fields are deliberately inspected before version/schema parsing:
    // the newest record for this exact scope is authoritative even when corrupt.
    if (entry.data.sessionId !== sessionId || entry.data.provider !== model.provider || entry.data.model !== model.id)
      continue;
    return setting(entry.data) ? { kind: "valid", value: entry.data } : { kind: "invalid" };
  }
  return { kind: "absent" };
}
function currentSetting(ctx: ExtensionContext, model = ctx.model): Setting | undefined {
  const found = resolveSetting(ctx, model);
  return found.kind === "valid" ? found.value : undefined;
}

export function nativeFastSupport(
  model: Pick<Model<any>, "provider" | "id" | "api" | "baseUrl">,
  oauth = false,
): { supported: true; tier: "priority"; surface: "api" | "chatgpt" | "codex" } | { supported: false; reason: string } {
  const baseUrl = normalizedUrl(model.baseUrl);
  if (model.provider === "openai") {
    if (model.api !== "openai-responses" || baseUrl !== OPENAI_BASE_URL || (oauth && model.baseUrl !== OPENAI_BASE_URL))
      return {
        supported: false,
        reason: "OpenAI native fast mode requires the official openai Responses endpoint and auth surface.",
      };
    // Pi 1.0.3 canonical OpenAI keeps the Responses API/endpoint for both
    // API keys and ChatGPT OAuth; it does not rewrite OAuth to legacy Codex.
    return { supported: true, tier: "priority", surface: oauth ? "chatgpt" : "api" };
  }
  if (model.provider === "openai-codex") {
    if (model.api !== "openai-codex-responses" || baseUrl !== CODEX_BASE_URL)
      return {
        supported: false,
        reason: "Codex native fast mode requires ChatGPT sign-in on the official Codex endpoint.",
      };
    // Match the official Codex ServiceTier::Fast request value.
    return { supported: true, tier: "priority", surface: "codex" };
  }
  if (model.provider === "anthropic")
    return {
      supported: false,
      reason:
        "Anthropic native fast mode is deferred: it requires speed=fast plus the fast-mode-2026-02-01 beta header; effort is not a substitute.",
    };
  return {
    supported: false,
    reason: "Native fast mode currently supports only official OpenAI API and Codex provider surfaces.",
  };
}

function authSurfaceMatches(ctx: ExtensionContext, surface: "api" | "chatgpt" | "codex", model = ctx.model): boolean {
  const oauth = model ? ctx.modelRegistry.isUsingOAuth(model) : false;
  return surface === "api" ? !oauth : oauth;
}

export function nativeFastEnabled(ctx: ExtensionContext): boolean {
  if (!ctx.model || !ctx.sessionManager?.getSessionId) return false;
  const active = currentSetting(ctx);
  if (!active?.enabled || !active.costAcknowledged) return false;
  const oauth = ctx.modelRegistry.isUsingOAuth(ctx.model);
  if (active.oauth !== oauth) return false;
  const support = nativeFastSupport(ctx.model, oauth);
  return support.supported && authSurfaceMatches(ctx, support.surface);
}

// Like Codex, this badge reports the selected mode, not response-tier evidence.
function statusText(enabled: boolean): string {
  return enabled ? " fast on" : " fast off";
}

type RequestAuthorization = {
  provider: string;
  model: string;
  oauth: boolean;
  tier?: "default" | "fast" | "priority";
  blocked?: string;
  operationId: OperationId;
  manager: object;
};
type FastController = {
  context?: ExtensionContext;
  capture(model: Model<any>, sessionId: unknown): RequestAuthorization | undefined;
};
type RuntimeSeam = {
  streamSimple: (model: Model<any>, context: Context, options?: Record<string, any>) => unknown;
  prepareRequest: (model: Model<any>, options?: Record<string, any>) => Promise<any>;
  isUsingOAuth: (provider: string) => boolean;
};
type RuntimePatch = {
  original: RuntimeSeam["streamSimple"];
  wrapper: RuntimeSeam["streamSimple"];
  controllers: Set<FastController>;
  ownDescriptor?: PropertyDescriptor;
};

const runtimePatches = new WeakMap<object, RuntimePatch>();
const COMPATIBILITY_ERROR =
  "Native fast mode is unavailable: pinned Pi 1.0.3 ModelRuntime compatibility seam is missing.";

/** Pi's extension emitter catches hook failures. Patch only this extension
 * context's runtime instance. Restore it when the last controller leaves. The
 * pinned Pi 0.85 seam is prepareRequest, then provider.streamSimple with the
 * final onPayload pipeline. */
function attachConcreteRequestGuard(runtime: unknown, controller: FastController): string | undefined {
  if (!record(runtime)) return COMPATIBILITY_ERROR;
  const seam = runtime as unknown as RuntimeSeam;
  if (
    typeof seam.streamSimple !== "function" ||
    typeof seam.prepareRequest !== "function" ||
    typeof seam.isUsingOAuth !== "function"
  )
    return COMPATIBILITY_ERROR;
  const existing = runtimePatches.get(runtime);
  if (existing) {
    if (seam.streamSimple !== existing.wrapper) return COMPATIBILITY_ERROR;
    existing.controllers.add(controller);
    return;
  }
  const original = seam.streamSimple;
  const patch: RuntimePatch = {
    original,
    wrapper: original,
    controllers: new Set([controller]),
    ownDescriptor: Object.getOwnPropertyDescriptor(runtime, "streamSimple"),
  };
  const wrapper: RuntimeSeam["streamSimple"] = function (this: RuntimeSeam, model, context, options) {
    const authorizations = [...patch.controllers]
      .map((candidate) => candidate.capture(model, options?.sessionId))
      .filter((value): value is RequestAuthorization => value !== undefined);
    if (authorizations.length === 0) return original.call(this, model, context, options);
    const authorization = authorizations[0];
    if (authorizations.length !== 1)
      return lazyStream(model, async () => {
        fastDiagnostic(authorization.manager, FAST_GUARD_AMBIGUOUS_AUTHORIZATION, "blocked", authorization.operationId);
        throw new Error("Native fast mode found ambiguous request authorization before dispatch.");
      });
    // Match ModelRuntime before bypassing its streamSimple dispatch: providers
    // take transcript messages, not separate systemPrompt and tools fields.
    const transcript = normalizeContext(context);
    const priorPayload = options?.onPayload;
    const guardedOptions = {
      ...options,
      ...(authorization.tier === undefined ? {} : { serviceTier: authorization.tier }),
      onPayload: async (payload: unknown, payloadModel: Model<any>) => {
        if (authorization.blocked) {
          fastDiagnostic(authorization.manager, FAST_GUARD_BLOCKED_AUTHORIZATION, "blocked", authorization.operationId);
          throw new Error(authorization.blocked);
        }
        if (authorization.tier === undefined) {
          fastDiagnostic(authorization.manager, FAST_GUARD_MISSING_TIER, "blocked", authorization.operationId);
          throw new Error("Native fast mode authorization did not select a provider tier.");
        }
        if (!record(payload)) {
          fastDiagnostic(authorization.manager, FAST_GUARD_INVALID_PAYLOAD, "blocked", authorization.operationId);
          throw new Error("Native fast mode rejected a non-object provider payload before dispatch.");
        }
        // Snapshot injection happens before the complete extension hook pipeline.
        // No hook can cause us to re-read mutable session/model state.
        payload.service_tier = authorization.tier;
        const finalPayload = priorPayload ? await priorPayload(payload, payloadModel) : payload;
        if (!record(finalPayload)) {
          fastDiagnostic(authorization.manager, FAST_GUARD_INVALID_PAYLOAD, "blocked", authorization.operationId);
          throw new Error("Native fast mode rejected a non-object provider payload before dispatch.");
        }
        if (finalPayload.model !== authorization.model) {
          fastDiagnostic(authorization.manager, FAST_GUARD_MODEL_MISMATCH, "blocked", authorization.operationId);
          throw new Error("Native fast mode rejected a provider payload for a different model before dispatch.");
        }
        if (finalPayload.service_tier !== authorization.tier) {
          fastDiagnostic(authorization.manager, FAST_GUARD_TIER_MUTATION, "blocked", authorization.operationId);
          throw new Error("Native fast mode rejected a late service-tier mutation before dispatch.");
        }
        return finalPayload;
      },
    };
    return lazyStream(model, async () => {
      const prepared = await this.prepareRequest(model, guardedOptions);
      if (
        !prepared ||
        typeof prepared.provider?.streamSimple !== "function" ||
        prepared.provider.id !== authorization.provider ||
        prepared.model?.provider !== authorization.provider ||
        prepared.model?.id !== authorization.model ||
        this.isUsingOAuth(authorization.provider) !== authorization.oauth
      ) {
        fastDiagnostic(authorization.manager, FAST_GUARD_IDENTITY_MISMATCH, "blocked", authorization.operationId);
        throw new Error("Native fast mode request identity or authentication changed before provider dispatch.");
      }
      if (authorization.blocked) {
        fastDiagnostic(authorization.manager, FAST_GUARD_BLOCKED_AUTHORIZATION, "blocked", authorization.operationId);
        throw new Error(authorization.blocked);
      }
      if (authorization.tier === undefined) {
        fastDiagnostic(authorization.manager, FAST_GUARD_MISSING_TIER, "blocked", authorization.operationId);
        throw new Error("Native fast mode authorization did not select a provider tier.");
      }
      if (authorization.tier !== "default") {
        const actualSupport = nativeFastSupport(prepared.model, authorization.oauth);
        if (!actualSupport.supported || actualSupport.tier !== authorization.tier) {
          fastDiagnostic(authorization.manager, FAST_GUARD_UNSUPPORTED_ENDPOINT, "blocked", authorization.operationId);
          throw new Error("Native fast mode actual provider endpoint is not authorized for this request.");
        }
      }
      if (authorization.tier !== "default" && authorization.provider === "openai") {
        // The pinned Responses transport selects ChatGPT behavior from the actual
        // credential, not ModelRegistry's login snapshot. Explicit request auth
        // overrides must not silently move consent to the other billing surface.
        const key = prepared.options?.apiKey;
        const headers = { ...prepared.model.headers, ...prepared.options?.headers };
        const authOverride = Object.entries(headers).some(
          ([name, value]) => name.toLowerCase() === "authorization" && value !== "Bearer " + key,
        );
        if (typeof key !== "string" || !key || !key.startsWith("sk-") !== authorization.oauth || authOverride) {
          fastDiagnostic(authorization.manager, FAST_GUARD_IDENTITY_MISMATCH, "blocked", authorization.operationId);
          throw new Error("Native fast mode resolved credentials do not match the authorized authentication surface.");
        }
      }
      return prepared.provider.streamSimple(prepared.model, transcript, prepared.options);
    });
  };
  patch.wrapper = wrapper;
  try {
    seam.streamSimple = wrapper;
  } catch {
    if (patch.ownDescriptor) Object.defineProperty(runtime, "streamSimple", patch.ownDescriptor);
    else delete (runtime as { streamSimple?: unknown }).streamSimple;
    return COMPATIBILITY_ERROR;
  }
  if (seam.streamSimple !== wrapper) {
    if (patch.ownDescriptor) Object.defineProperty(runtime, "streamSimple", patch.ownDescriptor);
    else delete (runtime as { streamSimple?: unknown }).streamSimple;
    return COMPATIBILITY_ERROR;
  }
  runtimePatches.set(runtime, patch);
}

function detachConcreteRequestGuard(runtime: object, controller: FastController): void {
  const patch = runtimePatches.get(runtime);
  if (!patch) return;
  patch.controllers.delete(controller);
  if (patch.controllers.size > 0) return;
  const seam = runtime as unknown as RuntimeSeam;
  if (seam.streamSimple === patch.wrapper) {
    if (patch.ownDescriptor) Object.defineProperty(runtime, "streamSimple", patch.ownDescriptor);
    else delete (runtime as { streamSimple?: unknown }).streamSimple;
  }
  runtimePatches.delete(runtime);
}

export function registerNativeFastMode(pi: ExtensionAPI) {
  let ui: ExtensionContext["ui"] | undefined;
  let inheritFast = process.env[NATIVE_FAST_CHILD_ENV] === "1" && Number(process.env.BRUV_SUBAGENT_DEPTH) > 0;
  delete process.env[NATIVE_FAST_CHILD_ENV];
  const controller: FastController = {
    capture(model, requestedSessionId) {
      const ctx = controller.context;
      if (!ctx || typeof requestedSessionId !== "string" || requestedSessionId !== ctx.sessionManager.getSessionId())
        return;
      if (standardTierScope.getStore() && officialSurface(model)) {
        return {
          operationId: crypto.randomUUID(),
          manager: ctx.sessionManager as object,
          provider: model.provider,
          model: model.id,
          tier: "default",
          oauth: ctx.modelRegistry.isUsingOAuth(model),
        };
      }
      const found = resolveSetting(ctx, model, requestedSessionId);
      if (found.kind === "absent") return;
      if (found.kind === "invalid")
        return {
          operationId: crypto.randomUUID(),
          manager: ctx.sessionManager as object,
          provider: model.provider,
          model: model.id,
          oauth: ctx.modelRegistry.isUsingOAuth(model),
          blocked:
            "Native fast mode rejected a malformed or unsupported authorization record; run /fast on or /fast off again.",
        };
      const active = found.value;
      if (!active.enabled) {
        return {
          operationId: crypto.randomUUID(),
          manager: ctx.sessionManager as object,
          provider: model.provider,
          model: model.id,
          tier: "default",
          oauth: ctx.modelRegistry.isUsingOAuth(model),
          ...(officialSurface(model)
            ? {}
            : { blocked: "Native fast opt-out no longer matches an official provider surface." }),
        };
      }
      const support = nativeFastSupport(model, ctx.modelRegistry.isUsingOAuth(model));
      const blocked =
        active.oauth !== ctx.modelRegistry.isUsingOAuth(model)
          ? "Native fast mode authentication surface changed; run /fast on again."
          : !active.costAcknowledged
            ? "Native fast mode authorization is missing; run /fast on again."
            : !support.supported
              ? support.reason
              : !authSurfaceMatches(ctx, support.surface, model)
                ? support.surface === "codex"
                  ? "Codex fast mode requires ChatGPT OAuth sign-in."
                  : "OpenAI API fast mode requires API-key authentication."
                : undefined;
      return {
        operationId: crypto.randomUUID(),
        manager: ctx.sessionManager as object,
        provider: model.provider,
        model: model.id,
        ...(blocked ? {} : { tier: support.supported ? support.tier : undefined }),
        oauth: ctx.modelRegistry.isUsingOAuth(model),
        ...(blocked ? { blocked } : {}),
      };
    },
  };
  let boundRuntime: object | undefined;
  const bindContext = (ctx: ExtensionContext): string | undefined => {
    controller.context = ctx;
    const runtime = (ctx.modelRegistry as unknown as { runtime?: object }).runtime;
    if (boundRuntime && boundRuntime !== runtime) detachConcreteRequestGuard(boundRuntime, controller);
    boundRuntime = runtime;
    return attachConcreteRequestGuard(runtime, controller);
  };
  pi.registerFlag("accept-cost", {
    type: "boolean",
    description: "Acknowledge premium provider billing when enabling /fast outside the TUI",
    default: false,
  });
  const refreshStatus = (ctx: ExtensionContext) => {
    bindContext(ctx);
    ui = ctx.ui;
    const active = currentSetting(ctx);
    ui?.setStatus("bruv-native-fast", active ? statusText(active.enabled) : undefined);
  };

  const persistSelection = (ctx: ExtensionContext, enabled: boolean) => {
    const model = ctx.model!;
    const sessionId = ctx.sessionManager.getSessionId();
    const priorLeaf = (ctx.sessionManager as { getLeafId?: () => string | null }).getLeafId?.();
    try {
      pi.appendEntry(NATIVE_FAST_ENTRY, {
        version: ENTRY_VERSION,
        oauth: ctx.modelRegistry.isUsingOAuth(model),
        sessionId,
        provider: model.provider,
        model: model.id,
        enabled,
        costAcknowledged: enabled,
        timestamp: Date.now(),
      } satisfies Setting);
    } catch {
      restoreLeaf(ctx.sessionManager, priorLeaf);
      if (!enabled) {
        let scopes = volatileOptOuts.get(ctx.sessionManager as object);
        if (!scopes) {
          scopes = new Set();
          volatileOptOuts.set(ctx.sessionManager as object, scopes);
        }
        scopes.add(settingScope(sessionId, model.provider, model.id));
      }
      throw new Error("Could not persist native fast mode; the requested setting was not activated.");
    }
    volatileOptOuts.get(ctx.sessionManager as object)?.delete(settingScope(sessionId, model.provider, model.id));
  };

  // Only explicit host user selection may call this: true is premium billing
  // consent, not a hint inferred from effort, an unsupported flag, or a badge.
  const setWithCostConsent = (enabled: boolean) => {
    const ctx = controller.context;
    if (!ctx?.model) throw new Error("Select a model before changing native fast mode");
    const compatibilityError = bindContext(ctx);
    const support = nativeFastSupport(ctx.model, ctx.modelRegistry.isUsingOAuth(ctx.model));
    if (enabled) {
      if (compatibilityError) throw new Error(compatibilityError);
      if (!support.supported) throw new Error(support.reason);
      if (!authSurfaceMatches(ctx, support.surface))
        throw new Error("Native fast mode authentication surface mismatch");
    } else if (!officialSurface(ctx.model)) {
      // Hosts also send false for models without a native Fast implementation.
      // No authorization is created on those surfaces.
      return;
    }
    persistSelection(ctx, enabled);
    refreshStatus(ctx);
  };

  pi.registerCommand("fast", {
    description: "Show or set opt-in provider-native fast mode (on, off, status)",
    getArgumentCompletions: (prefix) => {
      const value = prefix.trim().toLowerCase();
      return ["on", "off", "status"].filter((item) => item.startsWith(value)).map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const operationId = crypto.randomUUID();
      const compatibilityError = bindContext(ctx);
      const action = args.trim().toLowerCase() || "status";
      if (action === "status") {
        const active = currentSetting(ctx);
        const description = !active
          ? "off (no model-bound setting in this session)"
          : active.enabled
            ? statusText(true).replace(/^ /, "")
            : "off (explicit default/standard tier)";
        ctx.ui.notify(`Native fast mode: ${description}. Model and thinking are unchanged.`, "info");
        refreshStatus(ctx);
        return;
      }
      if (action !== "on" && action !== "off") {
        commandDiagnostic(ctx, FAST_REFUSED_INVALID_COMMAND, "blocked", operationId);
        ctx.ui.notify("Usage: /fast on|off|status", "error");
        return;
      }
      const model = ctx.model;
      if (!model) {
        commandDiagnostic(ctx, FAST_REFUSED_NO_MODEL, "blocked", operationId);
        ctx.ui.notify("Select a model before changing native fast mode.", "error");
        return;
      }
      const consentScope = {
        sessionId: ctx.sessionManager.getSessionId(),
        leafId: leafId(ctx),
        provider: model.provider,
        model: model.id,
      };
      const support = nativeFastSupport(model, ctx.modelRegistry.isUsingOAuth(model));
      if (action === "off" && !officialSurface(model)) {
        commandDiagnostic(ctx, FAST_REFUSED_UNSUPPORTED, "blocked", operationId);
        ctx.ui.notify(
          "Native fast opt-out applies only to the official OpenAI API and Codex provider surfaces.",
          "error",
        );
        return;
      }
      if (action === "on" && !support.supported) {
        commandDiagnostic(ctx, FAST_REFUSED_UNSUPPORTED, "blocked", operationId);
        ctx.ui.notify(support.reason, "error");
        return;
      }
      if (action === "on" && compatibilityError) {
        commandDiagnostic(ctx, FAST_REFUSED_COMPATIBILITY, "blocked", operationId);
        ctx.ui.notify(compatibilityError, "error");
        return;
      }
      if (action === "on") {
        if (!support.supported || !authSurfaceMatches(ctx, support.surface)) {
          commandDiagnostic(ctx, FAST_REFUSED_AUTH, "blocked", operationId);
          ctx.ui.notify(
            support.supported && support.surface === "codex"
              ? "Codex fast mode requires ChatGPT OAuth sign-in; API-key traffic uses the OpenAI API pricing surface."
              : "OpenAI API fast mode requires the API-key auth surface.",
            "error",
          );
          return;
        }
        let accepted = pi.getFlag("accept-cost") === true;
        if (!accepted && ctx.mode === "tui")
          accepted = await ctx.ui.confirm(
            "Enable premium fast mode?",
            support.supported && support.surface !== "api"
              ? "Fast mode also applies to new supported subagents. It uses premium ChatGPT subscription usage/credits. Provider billing is authoritative."
              : "Fast mode also applies to new supported subagents. It uses premium API token pricing. Provider billing is authoritative.",
          );
        if (!accepted) {
          commandDiagnostic(ctx, FAST_CANCELLED_COST, "cancelled", operationId, "caller");
          ctx.ui.notify("Fast mode was not enabled. Use the TUI confirmation or launch with --accept-cost.", "warning");
          return;
        }
      }
      const currentModel = ctx.model;
      if (
        !currentModel ||
        ctx.sessionManager.getSessionId() !== consentScope.sessionId ||
        leafId(ctx) !== consentScope.leafId ||
        currentModel.provider !== consentScope.provider ||
        currentModel.id !== consentScope.model
      ) {
        commandDiagnostic(ctx, FAST_REFUSED_STALE, "blocked", operationId);
        ctx.ui.notify(
          "Fast mode consent became stale because the session, branch, or model changed; nothing was enabled.",
          "warning",
        );
        return;
      }
      if (action === "on" && (!support.supported || !authSurfaceMatches(ctx, support.surface, currentModel))) {
        commandDiagnostic(ctx, FAST_REFUSED_STALE, "blocked", operationId);
        ctx.ui.notify(
          "Fast mode consent became stale because the authentication surface changed; nothing was enabled.",
          "warning",
        );
        return;
      }
      try {
        persistSelection(ctx, action === "on");
      } catch {
        commandDiagnostic(ctx, FAST_CHECKPOINT_PERSIST_FAILED, "failed", operationId);
        ctx.ui.notify("Could not persist native fast mode; the requested setting was not activated.", "error");
        return;
      }
      refreshStatus(ctx);
      ctx.ui.notify(
        action === "on"
          ? "Native fast mode on for this session, model, and new supported subagents. Requests use the priority service tier."
          : "Native fast mode off for this session and model; requests explicitly use the default/standard tier.",
        "info",
      );
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const compatibilityError = bindContext(ctx);
    if (inheritFast) {
      inheritFast = false;
      const model = ctx.model;
      const support = model && nativeFastSupport(model, ctx.modelRegistry.isUsingOAuth(model));
      if (
        !compatibilityError &&
        model &&
        support?.supported &&
        authSurfaceMatches(ctx, support.surface) &&
        resolveSetting(ctx).kind === "absent"
      ) {
        pi.appendEntry(NATIVE_FAST_ENTRY, {
          version: ENTRY_VERSION,
          oauth: ctx.modelRegistry.isUsingOAuth(model),
          sessionId: ctx.sessionManager.getSessionId(),
          provider: model.provider,
          model: model.id,
          enabled: true,
          costAcknowledged: true,
          timestamp: Date.now(),
        } satisfies Setting);
      }
    }
    refreshStatus(ctx);
    if (currentSetting(ctx)?.enabled && compatibilityError) {
      commandDiagnostic(ctx, FAST_REFUSED_COMPATIBILITY, "blocked", crypto.randomUUID());
      ctx.ui.notify(compatibilityError, "error");
    }
  });
  pi.on("model_select", (_event, ctx) => {
    refreshStatus(ctx);
  });
  pi.on("session_shutdown", () => {
    ui?.setStatus("bruv-native-fast", undefined);
    if (boundRuntime) detachConcreteRequestGuard(boundRuntime, controller);
    boundRuntime = undefined;
    controller.context = undefined;
    ui = undefined;
  });
  return { refreshStatus, currentSetting, setWithCostConsent };
}
