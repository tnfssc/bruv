import { voiceToolResult } from "./tool-result";
import { connectionFailure } from "./openai-connect-error";
import { upgradeSocket } from "./openai-upgrade-socket";
import { providerFailure } from "./openai-errors";
import { bruvSystemPrompt } from "../prompts";
import { OPENAI_REALTIME_MODELS } from "./providers";
import { InputResampler } from "./openai-resample";
import type {
  VoiceCallbacks,
  VoiceError,
  VoiceOrchestration,
  VoiceProvider,
  VoiceSessionOptions,
  VoiceState,
} from "./types";

/** Official WebSocket guide: https://developers.openai.com/api/docs/guides/realtime-websocket
 * GA Realtime events: https://developers.openai.com/api/docs/guides/realtime-conversations
 * Default model in the guide as of 2026-09-24; the catalogue also lists the mini Realtime model.
 */
export const OPENAI_VOICE_MODEL = OPENAI_REALTIME_MODELS[0];

const MAX_INPUT = 3200,
  MAX_PACKET = 96000; // 2 seconds PCM16 mono 24 kHz per packet
const MAX_TRANSCRIPT = 4096,
  MAX_TOOLS = 256;
const MAX_TOOL_BYTES = 1_048_576,
  CONNECT_MS = 15000;
/** Realtime error data is untrusted: only these protocol identifiers and structural paths are printable. */
const SAFE_PROVIDER_CODES = new Set([
  "invalid_request_error",
  "invalid_value",
  "invalid_type",
  "missing_required_parameter",
  "unknown_parameter",
  "unsupported_value",
  "unsupported_parameter",
  "invalid_enum_value",
  "invalid_model",
  "invalid_audio_format",
  "invalid_audio",
  "invalid_tool",
  "invalid_function_call",
  "authentication_error",
  "permission_denied",
  "server_error",
  "api_error",
  "rate_limit_exceeded",
  "insufficient_quota",
  "model_not_found",
  "invalid_api_key",
]);
const SAFE_PROVIDER_TYPES = new Set([
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "rate_limit_error",
  "api_error",
  "server_error",
  "invalid_request",
  "validation_error",
]);
const SAFE_FIELDS = new Set([
  "session",
  "session.type",
  "session.model",
  "session.instructions",
  "session.voice",
  "session.modalities",
  "session.output_modalities",
  "session.turn_detection",
  "session.turn_detection.type",
  "session.turn_detection.threshold",
  "session.turn_detection.prefix_padding_ms",
  "session.turn_detection.silence_duration_ms",
  "session.input_audio_format",
  "session.output_audio_format",
  "session.input_audio_transcription",
  "session.input_audio_transcription.model",
  "session.audio",
  "session.audio.input",
  "session.audio.output",
  "session.audio.input.format",
  "session.audio.input.format.type",
  "session.audio.input.format.rate",
  "session.audio.input.transcription",
  "session.audio.input.transcription.model",
  "session.audio.input.turn_detection",
  "session.audio.input.turn_detection.type",
  "session.audio.input.turn_detection.create_response",
  "session.audio.input.turn_detection.interrupt_response",
  "session.audio.input.turn_detection.threshold",
  "session.audio.input.turn_detection.prefix_padding_ms",
  "session.audio.input.turn_detection.silence_duration_ms",
  "session.audio.output.format",
  "session.audio.output.format.type",
  "session.audio.output.format.rate",
  "session.audio.output.voice",
  "session.tools",
  "session.tool_choice",
  "tools",
  "tool_choice",
]);
const SAFE_TOOL_FIELDS = new Set([
  "",
  ".type",
  ".name",
  ".description",
  ".parameters",
  ".parameters.type",
  ".parameters.properties",
  ".parameters.required",
  ".strict",
]);
function safeProviderField(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 100) return;
  if (SAFE_FIELDS.has(value)) return value;
  const normalized = value.replace(/\.(0|[1-9]\d{0,2})(?=\.|$)/g, "[$1]");
  // Array indexes are structural; names of properties/keys inside tool schemas are not.
  const match = /^(session\.)?tools\[(0|[1-9]\d{0,2})\](.*)$/.exec(normalized);
  if (match && SAFE_TOOL_FIELDS.has(match[3])) return normalized;
}
function voiceProviderFailure(error: unknown, model: string, fallback: string): string {
  const friendly = providerFailure(error, model, fallback);
  if (!error || typeof error !== "object") return friendly;
  const e = error as { code?: unknown; type?: unknown; param?: unknown };
  const field = safeProviderField(e.param);
  const details = [
    typeof e.code === "string" && SAFE_PROVIDER_CODES.has(e.code) ? "code " + e.code : undefined,
    typeof e.type === "string" && SAFE_PROVIDER_TYPES.has(e.type) ? "type " + e.type : undefined,
    field ? "field " + field : undefined,
  ].filter(Boolean);
  return details.length ? friendly + " (" + details.join(", ") + ")" : friendly;
}
const validBase64 = (s: string, max: number): boolean =>
  !!s &&
  s.length <= Math.ceil(max / 3) * 4 + 4 &&
  s.length % 4 === 0 &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(s) &&
  Buffer.from(s, "base64").length <= max;
const size = (x: unknown): number => Buffer.byteLength(JSON.stringify(x));
export interface RealtimeSocket {
  readyState: number;
  readonly bufferedAmount?: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", handler: (event: any) => void): void;
}
export type RealtimeSocketFactory = (url: string, headers: Record<string, string>) => RealtimeSocket;
export const defaultSocket: RealtimeSocketFactory = (url, headers) => upgradeSocket(url, headers);
type Call = { response?: Record<string, unknown>; dispatched?: boolean };
type ResponseState = {
  inputItem?: string;
  revision: number;
  done: boolean;
  cancelled: boolean;
  continued: boolean;
  calls: Map<string, Call>;
};
type AudioItem = { responseId: string; start: number; duration: number; contentIndex: number };
/** Provider item identity and playback timing, not PCM storage or response/tool authority.
 * A completed response can still have unheard audio, so its timing survives response retirement. */
class OutputAudioTimeline {
  private readonly origins = new Map<string, string>();
  private readonly queued = new Map<string, AudioItem>();
  private endMs = 0;

  registerItem(itemId: string, responseId: string): boolean {
    if (this.origins.size >= 128) return false;
    this.origins.set(itemId, responseId);
    return true;
  }

  belongsToResponse(itemId: string, responseId: string | undefined): boolean {
    return this.origins.get(itemId) === responseId;
  }

  append(itemId: string, responseId: string, bytes: number, contentIndex: unknown, getPlayedMs: () => number): boolean {
    let item = this.queued.get(itemId);
    if (!item) {
      if (this.queued.size >= 128) return false;
      item = {
        responseId,
        start: Math.max(this.endMs, getPlayedMs()),
        duration: 0,
        contentIndex: Number.isSafeInteger(contentIndex) ? (contentIndex as number) : 0,
      };
      this.queued.set(itemId, item);
    }
    // PCM16 mono 24 kHz: 48 bytes/ms. PlaybackScheduler, not this ledger, bounds queued PCM.
    item.duration += bytes / 48;
    this.endMs = Math.max(this.endMs, item.start + item.duration);
    return true;
  }

  get hasQueuedAudio(): boolean {
    return this.queued.size > 0;
  }

  *unheard(playedMs: number) {
    for (const [itemId, item] of this.queued) {
      if (Number.isFinite(playedMs) && playedMs >= 0 && playedMs < item.start + item.duration)
        yield {
          itemId,
          contentIndex: item.contentIndex,
          endMs: Math.max(0, Math.min(item.duration, Math.floor(playedMs - item.start))),
        };
    }
  }

  retirePlayed(playedMs: number, responseDone: (id: string) => boolean): void {
    for (const [itemId, item] of this.queued)
      if (responseDone(item.responseId) && playedMs >= item.start + item.duration) this.queued.delete(itemId);
  }

  forgetResponse(responseId: string): void {
    for (const [itemId, origin] of this.origins) if (origin === responseId) this.origins.delete(itemId);
  }

  clearQueuedAudio(): void {
    this.queued.clear();
    this.endMs = 0;
  }

  clear(): void {
    this.origins.clear();
    this.clearQueuedAudio();
  }
}
/** Single-use GA session. Context is a labeled host observation, never a new user message. */
export class OpenAIRealtimeSession implements VoiceProvider {
  private stateValue: VoiceState = "idle";
  private mainResponsePending = false;
  private mainResponseRequested = false;
  private socket?: RealtimeSocket;
  private serial = 0;
  private epoch = 0;
  private turnValue = 0;
  private inputChars = 0;
  private outputChars = 0;
  private inputRevision = 0;
  private pendingTools = 0;
  // Retained IDs enforce replay rejection and the tool-call budget; replies belong to their response.
  private readonly callIds = new Set<string>();
  private readonly resampler = new InputResampler();
  private manualAudioBytes = 0;
  private cancelConnect?: () => void;
  private readonly outputAudio = new OutputAudioTimeline();
  private committedItem?: string;
  private activeResponse?: string;
  private readonly responses = new Map<string, ResponseState>();
  private readonly transcripts = new Map<string, string>();
  private suppressAudio = false;
  private interruptedResponse?: string;
  readonly diagnostics = {
    serverInterruptions: 0,
    turnCompletions: 0,
    lastInterruptedAtMs: undefined as number | undefined,
  };
  constructor(
    private readonly callbacks: VoiceCallbacks,
    private readonly factory: RealtimeSocketFactory = defaultSocket,
    private readonly orchestration?: VoiceOrchestration,
    private readonly model: (typeof OPENAI_REALTIME_MODELS)[number] = OPENAI_VOICE_MODEL,
    private readonly options: VoiceSessionOptions = {},
  ) {}
  get state(): VoiceState {
    return this.stateValue;
  }
  get generation(): number {
    return this.epoch;
  }
  get turn(): number {
    return this.turnValue;
  }
  private stateTo(state: VoiceState): void {
    this.stateValue = state;
    try {
      this.callbacks.onState?.(state);
    } catch {
      /* external callback */
    }
  }
  private error(code: VoiceError["code"], message: string): void {
    try {
      this.callbacks.onError?.({ code, message });
    } catch {
      /* external callback */
    }
  }
  private fail(code: VoiceError["code"], message: string): void {
    if (this.stateValue === "closed") return;
    this.close();
    this.error(code, message);
  }
  private emit(fn: () => void): void {
    try {
      fn();
    } catch {
      this.fail("transport_error", "Voice callback failed");
    }
  }
  private send(event: Record<string, unknown>): void {
    if (this.stateValue !== "ready" || !this.socket) return;
    try {
      if ((this.socket.bufferedAmount ?? 0) > 1_048_576) {
        this.fail("transport_error", "Voice connection send queue exceeded its limit");
        return;
      }
      this.socket.send(JSON.stringify(event));
    } catch {
      this.fail("transport_error", "Could not send voice event");
    }
  }
  async connect(apiKey: string): Promise<void> {
    if (this.stateValue !== "idle") throw new Error("Voice session is single-use");
    if (!apiKey?.trim()) {
      this.fail("invalid_input", "API key is required");
      return;
    }
    const serial = ++this.serial;
    this.stateTo("connecting");
    if (this.state !== "connecting" || serial !== this.serial) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.cancelConnect = undefined;
        resolve();
      };
      this.cancelConnect = finish;
      const timer = setTimeout(() => {
        if (serial === this.serial) this.fail("connect_failed", "Voice connection timed out");
        finish();
      }, CONNECT_MS);
      timer.unref?.();
      let setupStage = "socket-construction";
      try {
        const socket = this.factory("wss://api.openai.com/v1/realtime?model=" + encodeURIComponent(this.model), {
          Authorization: "Bearer " + apiKey,
        });
        if (serial !== this.serial) {
          socket.close();
          finish();
          return;
        }
        this.socket = socket;
        setupStage = "socket-listeners";
        socket.addEventListener("open", () => {
          if (serial !== this.serial || this.stateValue !== "connecting") return;
          try {
            socket.send(
              JSON.stringify({
                type: "session.update",
                session: {
                  type: "realtime",
                  instructions: this.orchestration?.instructions ?? bruvSystemPrompt(),
                  audio: {
                    input: {
                      format: { type: "audio/pcm", rate: 24000 },
                      transcription: { model: "gpt-4o-mini-transcribe" },
                      turn_detection:
                        this.options.inputMode === "push-to-talk"
                          ? null
                          : { type: "server_vad", create_response: true, interrupt_response: true },
                    },
                    output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
                  },
                  output_modalities: ["audio"],
                  tools: (this.orchestration?.tools ?? []).map((tool) => ({
                    type: "function",
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parametersJsonSchema ?? tool.parameters ?? { type: "object", properties: {} },
                  })),
                  tool_choice: "auto",
                },
              }),
            );
          } catch {
            this.fail("transport_error", "Could not configure voice session");
            finish();
          }
        });
        socket.addEventListener("message", (event) => {
          if (serial !== this.serial) return;
          try {
            if (typeof event.data !== "string" || event.data.length > 500000) throw new Error("Oversize event");
            const message = JSON.parse(event.data);
            if (this.stateValue === "connecting" && message.type === "session.updated") {
              this.stateTo("ready");
              finish();
              this.emit(() => this.callbacks.onReady?.());
              return;
            }
            if (message.type === "error") {
              this.fail(
                this.stateValue === "connecting" ? "connect_failed" : "transport_error",
                voiceProviderFailure(
                  message.error,
                  this.model,
                  this.stateValue === "connecting"
                    ? "OpenAI rejected voice session setup"
                    : "Voice provider rejected event",
                ),
              );
              finish();
              return;
            }
            if (this.stateValue === "ready") this.receive(message);
          } catch {
            this.fail("transport_error", "Invalid voice event");
            finish();
          }
        });
        socket.addEventListener("error", (event) => {
          if (serial === this.serial) {
            this.fail(
              this.stateValue === "connecting" ? "connect_failed" : "transport_error",
              connectionFailure(event),
            );
            finish();
          }
        });
        socket.addEventListener("close", () => {
          if (serial === this.serial) {
            this.fail(
              this.stateValue === "connecting" ? "connect_failed" : "disconnected",
              this.stateValue === "connecting"
                ? "OpenAI WebSocket closed before session setup (HTTP status unavailable)."
                : "Voice connection closed",
            );
            finish();
          }
        });
      } catch {
        this.fail("connect_failed", "OpenAI transport setup failed [" + setupStage + "]; details withheld.");
        finish();
      }
    });
  }
  sendAudio(base64: string): void {
    if (this.stateValue !== "ready") return;
    if (!validBase64(base64, MAX_INPUT) || Buffer.from(base64, "base64").length % 2) {
      this.error("invalid_input", "Invalid PCM16 input chunk");
      return;
    }
    try {
      if (this.options.inputMode === "push-to-talk" && !this.manualAudioBytes) {
        this.inputActivity(true);
        if (this.stateValue !== "ready") return;
      }
      const pcm = this.resampler.push(Buffer.from(base64, "base64"));
      if (pcm.length) {
        this.send({ type: "input_audio_buffer.append", audio: Buffer.from(pcm).toString("base64") });
        if (this.options.inputMode === "push-to-talk" && this.stateValue === "ready")
          this.manualAudioBytes += pcm.length;
      }
    } catch {
      this.fail("invalid_audio", "Could not resample input audio");
    }
  }
  /** Manual release commits a held turn; continuous mode leaves commits to server VAD. */
  endAudio(): void {
    if (this.stateValue === "ready") {
      const final = this.resampler.flush();
      if (final.length) this.send({ type: "input_audio_buffer.append", audio: Buffer.from(final).toString("base64") });
      if (this.options.inputMode === "push-to-talk") {
        const bytes = this.manualAudioBytes + final.length;
        this.manualAudioBytes = 0;
        if (this.stateValue !== "ready" || !bytes) return;
        // Realtime requires at least 100 ms: PCM16 mono 24 kHz = 4,800 bytes.
        // Discard short holds rather than leaking them into the next turn or padding silence.
        if (bytes < 4800) {
          this.send({ type: "input_audio_buffer.clear" });
          return;
        }
        this.send({ type: "input_audio_buffer.commit" });
        this.mainResponsePending = true;
        this.flushMainResponse();
      }
    } else this.resampler.reset();
  }
  sendContext(text: string, options?: { triggerResponse?: boolean }): void {
    if (this.stateValue !== "ready" || !text) return;
    if (Buffer.byteLength(text) > 1_048_576) {
      this.fail(
        "invalid_input",
        "Main context exceeds the 1 MiB voice wire budget; resume in text to inspect the full branch",
      );
      return;
    }
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    if (options?.triggerResponse !== false) {
      this.mainResponsePending = true;
      this.flushMainResponse();
    }
  }
  private flushMainResponse(): void {
    if (!this.mainResponsePending || this.mainResponseRequested || this.stateValue !== "ready" || this.pendingTools)
      return;
    const active = this.activeResponse && this.responses.get(this.activeResponse);
    if (active && !active.done) return;
    this.mainResponsePending = false;
    this.mainResponseRequested = true;
    this.send({ type: "response.create" });
  }
  closeError?: string;
  close(): void {
    if (this.stateValue === "closed") return;
    ++this.serial;
    this.cancelConnect?.();
    this.resampler.reset();
    this.manualAudioBytes = 0;
    this.callIds.clear();
    this.responses.clear();
    this.transcripts.clear();
    this.outputAudio.clear();
    const socket = this.socket;
    this.socket = undefined;
    this.stateTo("closed");
    try {
      socket?.close();
    } catch {
      this.closeError = "Provider connection close failed";
    }
  }
  private interrupt(server = true): void {
    this.committedItem = undefined;
    ++this.inputRevision;
    if (server) {
      ++this.diagnostics.serverInterruptions;
      this.diagnostics.lastInterruptedAtMs = performance.now();
    }
    const played = this.callbacks.getPlayedAudioMs?.() ?? 0;
    for (const item of this.outputAudio.unheard(played))
      this.send({
        type: "conversation.item.truncate",
        item_id: item.itemId,
        content_index: item.contentIndex,
        audio_end_ms: item.endMs,
      });
    this.interruptedResponse = this.activeResponse;
    const response = this.activeResponse && this.responses.get(this.activeResponse);
    if (response) response.cancelled = true;
    this.outputAudio.clearQueuedAudio();
    ++this.epoch;
    this.emit(() => this.callbacks.onInterrupted?.(this.epoch));
  }
  private continueResponse(id: string): void {
    const response = this.responses.get(id);
    if (
      !response ||
      !response.done ||
      response.continued ||
      response.cancelled ||
      response.revision !== this.inputRevision ||
      !response.calls.size ||
      [...response.calls.values()].some((call) => !call.response)
    )
      return;
    response.continued = true;
    this.mainResponsePending = true;
    this.flushMainResponse();
  }
  private toolDone(message: any): void {
    if (!this.orchestration || typeof message.call_id !== "string" || !message.call_id || message.call_id.length > 256)
      return;
    const id = message.call_id,
      name = message.name,
      responseId = message.response_id;
    const response = typeof responseId === "string" ? this.responses.get(responseId) : undefined;
    if (!response || response.cancelled || response.done || this.callIds.has(id)) return;
    if (this.callIds.size >= MAX_TOOLS) {
      this.fail("invalid_input", "Tool call limit exceeded");
      return;
    }
    const entry: Call = {};
    this.callIds.add(id);
    response.calls.set(id, entry);
    const reply = (output: Record<string, unknown>) => {
      if (entry.response || this.stateValue !== "ready") return;
      if (response.cancelled && !entry.dispatched) {
        entry.response = output;
        return;
      }
      entry.response = output;
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: id, output: JSON.stringify(output) },
      });
      this.continueResponse(responseId);
    };
    let args: Record<string, unknown>;
    try {
      if (
        typeof name !== "string" ||
        !this.orchestration.tools.some((tool) => tool.name === name) ||
        typeof message.arguments !== "string" ||
        message.arguments.length > MAX_TOOL_BYTES
      )
        throw Error();
      const parsed: unknown = JSON.parse(message.arguments);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || size(parsed) > MAX_TOOL_BYTES)
        throw Error();
      args = parsed as Record<string, unknown>;
    } catch {
      reply({ error: "Tool request rejected" });
      return;
    }
    if (this.pendingTools >= 16) {
      reply({ error: "Tool request rejected" });
      return;
    }
    ++this.pendingTools;
    // Dispatch off the socket callback. Closing/cancellation revokes only pending calls.
    void Promise.resolve()
      .then(() => {
        if (this.stateValue !== "ready" || response.cancelled)
          throw new Error("Tool request invalidated before dispatch");
        entry.dispatched = true;
        return this.orchestration!.execute({ id, name, args });
      })
      .then(
        (result) => voiceToolResult(result, this.orchestration?.artifactDirectory).then(reply),
        () => reply({ error: "Tool execution failed" }),
      )
      .finally(() => {
        --this.pendingTools;
        this.flushMainResponse();
      });
    // Registered execute owns timeout and cancellation, never the transport.
  }

  private inputActivity(manual = false): void {
    const active = this.activeResponse && this.responses.get(this.activeResponse);
    // With VAD disabled the server will not cancel the older response for us.
    if (manual && active && !active.done && !active.cancelled)
      this.send({ type: "response.cancel", response_id: this.activeResponse });
    this.suppressAudio = true;
    if (active) active.cancelled = true;
    this.committedItem = undefined;
    for (const response of this.responses.values()) response.continued = true;
    ++this.inputRevision;
    this.emit(() => this.callbacks.onInputActivity?.());
    if (this.outputAudio.hasQueuedAudio) this.interrupt(!manual);
  }

  private receive(m: any): void {
    switch (m.type) {
      case "input_audio_buffer.committed":
        if (typeof m.item_id === "string" && m.item_id.length <= 256) this.committedItem = m.item_id;
        break;
      case "input_audio_buffer.speech_started":
        this.inputActivity();
        break;
      case "conversation.item.input_audio_transcription.completed": {
        if (typeof m.item_id === "string" && this.transcripts.has(m.item_id)) return;
        if (
          typeof m.transcript !== "string" ||
          m.transcript.length > MAX_TRANSCRIPT ||
          this.inputChars + m.transcript.length > MAX_TRANSCRIPT
        ) {
          this.fail("transcript_limit", "Voice transcription limit exceeded");
          return;
        }
        this.inputChars += m.transcript.length;
        this.emit(() =>
          this.callbacks.onInputTranscript?.({
            text: m.transcript,
            finished: true,
            rawFinished: true,
            finalitySource: "provider",
          }),
        );
        if (this.state !== "ready") return;
        if (typeof m.item_id !== "string" || m.item_id.length > 256) return;
        const authorized = [...this.responses.values()].some(
          (r) => r.inputItem === m.item_id && r.revision === this.inputRevision && !r.cancelled,
        );
        if (m.item_id !== this.committedItem && !authorized) return;
        this.transcripts.set(m.item_id, m.transcript);
        if (this.transcripts.size > 32) this.transcripts.delete(this.transcripts.keys().next().value!);
        break;
      }
      case "conversation.item.input_audio_transcription.failed":
        // A stale failed transcription must not invalidate a newer speech item.
        if (typeof m.item_id !== "string" || m.item_id !== this.committedItem) return;
        ++this.inputRevision;
        break;
      case "response.created": {
        this.mainResponseRequested = false;
        if (typeof m.response?.id !== "string") {
          this.fail("invalid_input", "Response without ID");
          return;
        }
        const played = this.callbacks.getPlayedAudioMs?.() ?? 0;
        this.outputAudio.retirePlayed(played, (id) => this.responses.get(id)?.done === true);
        for (const [id, old] of this.responses) {
          if (old.done && [...old.calls.values()].every((call) => call.response)) {
            for (const call of old.calls.keys()) this.callIds.delete(call);
            this.responses.delete(id);
            this.outputAudio.forgetResponse(id);
          }
        }
        if (this.responses.size >= 32) {
          this.fail("invalid_input", "Response limit exceeded");
          return;
        }
        this.activeResponse = m.response.id;
        this.responses.set(m.response.id, {
          inputItem: this.committedItem,
          revision: this.inputRevision,
          done: false,
          cancelled: false,
          continued: false,
          calls: new Map(),
        });
        this.suppressAudio = false;
        break;
      }
      case "response.output_item.added":
        if (m.item?.type === "message" && typeof m.item.id === "string") {
          if (
            typeof m.response_id !== "string" ||
            !this.responses.has(m.response_id) ||
            !this.outputAudio.registerItem(m.item.id, m.response_id)
          ) {
            this.fail("invalid_audio", "Output item limit exceeded");
            return;
          }
        }
        break;
      case "response.output_audio.delta": {
        if (
          this.suppressAudio ||
          typeof m.item_id !== "string" ||
          !this.outputAudio.belongsToResponse(m.item_id, this.activeResponse) ||
          (m.response_id && m.response_id !== this.activeResponse)
        )
          return;
        if (typeof m.delta !== "string" || !validBase64(m.delta, MAX_PACKET)) {
          this.fail("invalid_audio", "Invalid output audio chunk");
          return;
        }
        const bytes = Buffer.from(m.delta, "base64").length;
        if (bytes < 2 || bytes % 2) {
          this.fail("invalid_audio", "Invalid output audio chunk");
          return;
        }
        if (
          !this.outputAudio.append(
            m.item_id,
            this.activeResponse!,
            bytes,
            m.content_index,
            () => this.callbacks.getPlayedAudioMs?.() ?? 0,
          )
        ) {
          this.fail("invalid_audio", "Audio item limit exceeded");
          return;
        }
        this.emit(() => this.callbacks.onAudio?.(m.delta, this.epoch));
        break;
      }
      case "response.output_audio_transcript.delta":
      case "response.output_audio_transcript.done": {
        if (m.response_id && !this.responses.has(m.response_id)) return;
        if (
          typeof (m.type.endsWith(".done") ? m.transcript : m.delta) !== "string" ||
          (m.type.endsWith(".done") ? 0 : m.delta.length) + this.outputChars > MAX_TRANSCRIPT
        ) {
          this.fail("transcript_limit", "Voice transcription limit exceeded");
          return;
        }
        const final = m.type.endsWith(".done");
        const text = final ? m.transcript : m.delta;
        if (text.length > MAX_TRANSCRIPT) {
          this.fail("transcript_limit", "Voice transcription limit exceeded");
          return;
        }
        if (!final) this.outputChars += text.length;
        this.emit(() =>
          this.callbacks.onOutputTranscript?.(
            {
              text,
              finished: final,
              ...(final ? { replace: true, rawFinished: true, finalitySource: "provider" as const } : {}),
              ...(this.suppressAudio || this.responses.get(m.response_id)?.cancelled ? { interrupted: true } : {}),
            },
            this.epoch,
          ),
        );
        break;
      }
      case "response.function_call_arguments.done":
        this.toolDone(m);
        break;
      case "response.done": {
        const id = m.response?.id;
        const response = typeof id === "string" ? this.responses.get(id) : undefined;
        if (!response || response.done) break;
        response.done = true;
        if (m.response.usage) this.emit(() => this.callbacks.onUsage?.(m.response.usage, id));
        if (m.response.status === "cancelled") {
          response.cancelled = true;
          if (id === this.activeResponse && this.interruptedResponse !== id && response.revision === this.inputRevision)
            this.interrupt();
          this.interruptedResponse = undefined;
        } else if (m.response.status === "completed") {
          // VAD can revoke this response before its late completed event; only the current input may close a turn.
          if (id === this.activeResponse && !response.cancelled && response.revision === this.inputRevision) {
            ++this.diagnostics.turnCompletions;
            this.emit(() => this.callbacks.onTurnComplete?.(this.turnValue++));
            this.inputChars = this.outputChars = 0;
          }
          this.continueResponse(id);
        } else {
          response.cancelled = true;
          this.error(
            "transport_error",
            voiceProviderFailure(m.response.status_details?.error, this.model, "Voice response did not complete"),
          );
        }
        this.flushMainResponse();
        break;
      }
    }
  }
}
