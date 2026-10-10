import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TranscriptLog } from "../session/transcript";
import type { CompactEditor } from "../ui/editor";
import { getActiveCompactEditor } from "../ui/startup";
import { type AudioCallbacks, type AudioSetupError, LiveAudio } from "./audio";
import { type LiveConfig, type LiveInputMode, loadLiveConfig, saveLiveConfig } from "./config";
import {
  markPassiveConversationTranscript,
  presentCanonicalVoiceMessage,
  registerConversationRenderers,
  savePassiveConversationTranscript,
} from "./conversation";
import { VOICE_COST_ENTRY, VoiceCostTracker } from "./cost";
import { createDefaultLiveCredentialService, type LiveCredentialService, type LiveProviderId } from "./credentials";
import { audioDiagnostic, audioLaunchDiagnostic } from "./diagnostics";
import { gptLiveContext } from "./gpt-live-context";
import { GptLiveDelegationBridge } from "./gpt-live-delegation";
import { GptLivePlaybackRecovery } from "./gpt-live-playback";
import { gptLiveRequest } from "./gpt-live-request";
import { type GPTLiveCallbacks, GPTLiveSession } from "./gpt-live-session";
import { type LiveStopResult, registerLiveStop } from "./lifecycle-access";
import { acquireMainOwner, type MainOwner } from "./main-owner";
import { OpenAIRealtimeSession } from "./openai-session";
import { withoutPassiveLiveHistory } from "./passive-history";
import { PlaybackScheduler } from "./playback";
import { LIVE_PROVIDERS, type LiveModelId, OPENAI_LIVE_MODEL, OPENAI_REALTIME_MODELS } from "./providers";
import { VoiceSession } from "./session";
import { runLiveSetup } from "./setup";
import { compactLiveStatus, liveLocalOnly } from "./status";
import type { VoiceCallbacks, VoiceOrchestration, VoiceProvider } from "./types";

const ID = "bruv-live";
const MAX_VISIBLE = 8;
const clean = (value: string) =>
  stripVTControlCharacters(value)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal escape sequences from untrusted transcript text.
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))?/g, "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal and bidi controls while keeping normal whitespace.
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ");

function stopWarning(errors: readonly string[]): string {
  const audio = errors.some((error) => /audio/i.test(error));
  const connection = errors.some((error) => !/audio/i.test(error));
  if (audio && connection)
    return "Voice cleanup wasn't confirmed. Check your system mic indicator; the voice connection may also still be open.";
  if (audio) return "Couldn't confirm microphone shutdown. Check your system mic indicator.";
  return "Couldn't confirm the voice connection closed.";
}

export interface LiveDependencies {
  local(mode: string): boolean;
  /** Local-only bounded test; result is a sanitized human-readable summary, never PCM. */
  speakerCheck(args: { audio: LiveDependencies["audio"]; signal: AbortSignal }): Promise<string>;
  key(signal: AbortSignal, provider?: LiveProviderId): Promise<string>;
  credentials(signal: AbortSignal, provider?: LiveProviderId): Promise<LiveCredentialService>;
  config: { load(): Promise<LiveConfig>; save(config: LiveConfig): Promise<void> };
  voice(
    callbacks: VoiceCallbacks,
    orchestration?: VoiceOrchestration,
    provider?: LiveProviderId,
    model?: LiveModelId,
    inputMode?: LiveInputMode,
  ): Pick<VoiceProvider, "connect" | "sendAudio" | "close" | "state" | "generation"> &
    Partial<Pick<VoiceProvider, "sendContext" | "endAudio">> & {
      diagnostics?: { serverInterruptions: number; turnCompletions: number; lastInterruptedAtMs?: number };
    };
  owner: typeof acquireMainOwner;
  gptSession?: (callbacks: GPTLiveCallbacks) => GPTLiveSession;
  audio(
    callbacks: AudioCallbacks,
    signal: AbortSignal,
  ): Promise<
    Pick<LiveAudio, "start" | "play" | "flush" | "stop" | "close" | "diagnostics"> &
      Partial<Pick<LiveAudio, "setCaptureGate">>
  >;
}
const defaults: LiveDependencies = {
  speakerCheck: async (args) => {
    const { runSpeakerCheck } = await import("./speaker-check");
    const { speakerCheckSummary } = await import("./speaker-summary");
    return speakerCheckSummary(await runSpeakerCheck(args.audio, args.signal));
  },
  local: (mode) =>
    (process.platform === "darwin" || process.platform === "linux") &&
    liveLocalOnly(mode, process.env, Boolean(process.stdin.isTTY && process.stdout.isTTY)),
  credentials: createDefaultLiveCredentialService,
  key: async (signal, provider = "google") =>
    (await createDefaultLiveCredentialService(signal, provider)).loadKey(signal),
  config: { load: loadLiveConfig, save: saveLiveConfig },
  voice: (
    callbacks,
    orchestration,
    provider = "google",
    model = OPENAI_REALTIME_MODELS[0],
    inputMode = "continuous",
  ) => {
    if (!orchestration?.instructions)
      throw new Error(
        "Main Live requires the current ordinary root owner and execute runtime; no companion fallback is available",
      );

    return provider === "openai"
      ? new OpenAIRealtimeSession(
          callbacks,
          undefined,
          orchestration,
          model as (typeof OPENAI_REALTIME_MODELS)[number],
          { inputMode },
        )
      : new VoiceSession(callbacks, undefined, orchestration, model, { inputMode });
  },
  owner: acquireMainOwner,
  audio: (callbacks, signal) => LiveAudio.launch({ callbacks, signal }),
};

type NativeAudio = Awaited<ReturnType<LiveDependencies["audio"]>>;
type NativeVoice = ReturnType<LiveDependencies["voice"]>;

/** Live owns the ordinary main-agent session; audio interruption never cancels jobs. */
export default function liveExtension(pi: ExtensionAPI, injected: Partial<LiveDependencies> = {}): void {
  let conversationCtx: ExtensionContext | undefined;
  registerConversationRenderers(
    pi,
    () => conversationCtx?.sessionManager.getBranch().filter((entry) => entry.type === "custom_message") ?? [],
  );
  // Session history survives voice shutdown and reload; this boundary must not.
  pi.on("context", (event) => ({ messages: withoutPassiveLiveHistory(event.messages) }));
  const deps = { ...defaults, ...injected };
  let selected: LiveConfig = { provider: "google", model: LIVE_PROVIDERS.google.models[0] };
  let loaded = false;
  let loading: Promise<LiveConfig> | undefined;
  let saving = false;
  let current: Run | undefined;
  let stoppingRun: Run | undefined;
  let sequence = 0;
  let confirmation: number | undefined;
  let entry: AbortController | undefined;
  let probe: AbortController | undefined;
  let speakerProbe: AbortController | undefined;
  class Run {
    readonly id = ++sequence;
    readonly provider = selected.provider;
    readonly model = selected.model;
    readonly inputMode = selected.inputMode ?? "push-to-talk";
    private holdSequence = 0;
    private heldEpoch: number | null = null;
    private talkEditor?: CompactEditor;
    private detachTalkInput?: () => void;
    readonly controller = new AbortController();
    readonly cost = new VoiceCostTracker(this.provider, this.model, (entry) => {
      // A late close must never write the old provider bill into a resumed/new session.
      if (this.sessionId !== this.ctx.sessionManager?.getSessionId?.()) return;
      pi.appendEntry(VOICE_COST_ENTRY, entry);
      // Footer reads persisted usage; request a redraw only on provider events.
      this.ctx.ui.setStatus("bruv-live-cost", entry.unknown ? "unknown" : "updated");
    });
    readonly sessionId: string | undefined;
    private stopping?: Promise<LiveStopResult>;
    voice?: NativeVoice;
    gpt?: GPTLiveSession;
    gptBridge?: GptLiveDelegationBridge;
    gptPlayback?: GptLivePlaybackRecovery;
    private gptCaptureMs = 0;
    private gptSpeechEpoch = 0;

    private inputUtterance = "";
    owner?: MainOwner;
    private outputUtterance = "";
    private initialContext: Array<{ text: string; options?: { triggerResponse?: boolean } }> = [];
    private initialContextBytes = 0;
    audio?: NativeAudio;
    private audioLaunchPending = false;
    state = "starting"; // lifecycle only: capture and pump run regardless of presentation
    speaking = false;
    thinking = false;
    generationFinished = false;
    heardQueue = false;
    private renderTimer?: ReturnType<typeof setTimeout>;
    private lastRender = 0;
    private lastStatus?: string;
    private lastWidget?: string;
    private editorTimer?: ReturnType<typeof setInterval>;
    private gptTranscriptIdle?: ReturnType<typeof setTimeout>;
    private gptAdmittedUserText?: string;
    readonly transcriptLog = new TranscriptLog(
      (entry) => {
        const owner = this.owner;
        if (!owner) return;
        if (owner.delegatedVoice) {
          const represented = entry.speaker === "You" && this.gptAdmittedUserText?.endsWith(entry.text.trim()) === true;
          markPassiveConversationTranscript(owner, entry, !represented);
          if (entry.speaker === "You") this.gptAdmittedUserText = undefined;
        } else if (entry.superseded) savePassiveConversationTranscript(owner, entry, false);
      },
      { groupTurns: true },
    );
    pendingBytes = 0;
    inFlight = false;
    readonly playback: PlaybackScheduler;
    generation = 0;
    inputFrames = 0;
    completedInputTranscripts = 0;
    outputBytes = 0;
    turns = 0;
    queuedMs = 0;
    constructor(readonly ctx: ExtensionContext) {
      this.sessionId = ctx.sessionManager?.getSessionId?.();
      const playbackOptions: ConstructorParameters<typeof PlaybackScheduler>[0] = {
        send: (frame, epoch) => {
          if (!this.audio) return Promise.reject(new Error("Audio not ready"));
          return this.audio.play(frame, epoch);
        },
        flush: (epoch) => (this.audio ? this.audio.flush(epoch) : Promise.reject(new Error("Audio not ready"))),
        onError: (error) => this.fail(error.message),
        onState: (s) => {
          if (!this.alive) return;
          this.pendingBytes = s.pendingBytes;
          this.inFlight = s.inFlight;
          this.drain();
          this.render();
        },
      };
      this.playback = new PlaybackScheduler(playbackOptions);
    }
    get alive() {
      return (
        current === this &&
        !this.controller.signal.aborted &&
        this.sessionId === this.ctx.sessionManager?.getSessionId?.()
      );
    }
    get inputState() {
      return this.inputMode === "continuous" ? "continuous mic" : this.heldEpoch === null ? "muted" : "talking";
    }
    private setTalking(talking: boolean) {
      if (!this.alive || this.state !== "running" || this.inputMode !== "push-to-talk") return;
      if (talking === (this.heldEpoch !== null)) return;
      // Close the host send gate first, before any asynchronous helper command.
      this.heldEpoch = talking ? ++this.holdSequence : null;
      if (!talking) this.voice?.endAudio?.();
      void this.audio?.setCaptureGate?.(this.heldEpoch).catch(() => {
        if (this.alive) this.fail("Could not change mic send gate; Live stopped.");
      });
      this.render(true);
    }
    private noteGptTranscriptActivity() {
      if (this.gptTranscriptIdle) clearTimeout(this.gptTranscriptIdle);
      this.gptTranscriptIdle = setTimeout(() => {
        this.gptTranscriptIdle = undefined;
        if (!this.alive) return;
        // Received text paused; not provider finality or proof of audible playback.
        this.transcriptLog.finish("Voice", "turn-boundary");
        this.render(true);
      }, 800);
      this.gptTranscriptIdle.unref?.();
    }
    private syncTalkInput() {
      if (!this.alive || this.state !== "running" || this.inputMode !== "push-to-talk") return;
      const editor = getActiveCompactEditor();
      if (editor === this.talkEditor) return;
      const detach = this.detachTalkInput;
      this.detachTalkInput = undefined;
      this.talkEditor = editor;
      detach?.();
      if (!editor) return;
      this.detachTalkInput = editor.attachPushToTalk(this.ctx.ui, {
        signal: this.controller.signal,
        onTalking: (talking) => this.setTalking(talking),
        onHint: () => this.render(true),
      });
    }
    render(immediate = false) {
      if (!this.alive) return;
      this.syncTalkInput();
      if (!immediate && Date.now() - this.lastRender < 100) {
        if (!this.renderTimer)
          this.renderTimer = setTimeout(
            () => {
              this.renderTimer = undefined;
              this.render(true);
            },
            100 - (Date.now() - this.lastRender),
          );
        return;
      }
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
        this.renderTimer = undefined;
      }
      this.lastRender = Date.now();
      const status = compactLiveStatus({
        running: this.state === "running",
        inputMode: this.inputMode,
        talking: this.heldEpoch !== null,
        inputAvailable: Boolean(this.talkEditor),
        speaking: this.speaking,
        thinking: this.thinking,
      });
      if (status !== this.lastStatus) {
        this.ctx.ui.setStatus(ID, status);
        this.lastStatus = status;
      }
      const visible = this.transcriptLog.draftView(clean).slice(-MAX_VISIBLE);
      const widget = JSON.stringify(visible);
      if (widget !== this.lastWidget) {
        this.ctx.ui.setWidget(ID, visible.length ? visible : undefined);
        this.lastWidget = widget;
      }
    }
    drain() {
      if (
        this.generationFinished &&
        this.pendingBytes === 0 &&
        !this.inFlight &&
        this.queuedMs === 0 &&
        this.heardQueue &&
        this.speaking
      ) {
        this.speaking = false;
        this.render(true);
      }
    }
    output(base64: string, epoch: number) {
      if (!this.alive || epoch !== this.generation) return;
      const pcm = Buffer.from(base64, "base64");
      this.outputBytes += pcm.length;
      if (pcm.length) {
        this.speaking = true;
        this.generationFinished = false;
      }
      this.playback.enqueue(pcm, epoch);
      this.render();
    }
    interrupt(epoch: number) {
      this.owner?.interrupt();
      this.outputUtterance = "";
      if (!this.alive || epoch <= this.generation) return;
      this.inputUtterance = "";
      this.transcriptLog.finish("Voice", "interrupted");
      this.transcriptLog.finish("You", "partial");
      this.generation = epoch;
      this.pendingBytes = 0;
      this.queuedMs = 0;
      this.speaking = false;
      this.generationFinished = false;
      this.heardQueue = false;
      this.playback.interrupt(epoch);
      this.render(true);
    }
    fail(message: string) {
      if (!this.alive) return;
      this.stop();
      if (this.sessionId === this.ctx.sessionManager?.getSessionId?.())
        this.ctx.ui.notify(`Live stop requested: ${message}. No agent work was cancelled.`, "warning");
    }
    stop() {
      void this.stopObserved();
    }
    stopObserved(): Promise<LiveStopResult> {
      if (this.stopping) return this.stopping;
      if (current !== this)
        return Promise.resolve({ stopped: false, errors: ["Live session is no longer active"], jobsUnchanged: true });
      this.transcriptLog.finish("You", "partial");
      this.transcriptLog.finish("Voice", "partial");
      current = undefined;
      stoppingRun = this;
      this.owner?.close(); // No await: live.stop can be called by the admitted execute itself.
      this.inputUtterance = this.outputUtterance = "";
      this.initialContext = [];
      this.initialContextBytes = 0;
      this.heldEpoch = null;
      this.controller.abort();
      this.state = "off";
      this.playback.close();
      this.gptBridge?.close();
      if (this.gptTranscriptIdle) clearTimeout(this.gptTranscriptIdle);
      this.gptTranscriptIdle = undefined;
      this.gptPlayback?.close();
      if (this.editorTimer) clearInterval(this.editorTimer);
      this.editorTimer = undefined;
      this.pendingBytes = 0;
      this.transcriptLog.reset();
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
      const voice = this.gpt ?? this.voice;
      const audio = this.audio;
      const audioLaunchPending = this.audioLaunchPending;
      this.audio = undefined;
      this.ctx.ui.setStatus(ID, undefined);

      this.ctx.ui.setWidget(ID, undefined);
      this.stopping = (async () => {
        const errors: string[] = audioLaunchPending ? ["Audio startup is not done; teardown not yet seen"] : [];
        let providerFinalized = true;
        await Promise.all([
          (async () => {
            if (!audio) return;
            try {
              await audio.stop();
              if ("stopError" in audio && typeof audio.stopError === "string") errors.push(audio.stopError);
            } catch {
              errors.push("Audio stop failed");
            }
            try {
              await audio.close();
            } catch {
              errors.push("Audio close failed");
            }
          })(),
          (async () => {
            try {
              await voice?.close();
              if (voice && "closeError" in voice && typeof voice.closeError === "string") {
                errors.push(voice.closeError);
                providerFinalized = false;
              }
            } catch {
              errors.push("Provider socket failed to close");
              providerFinalized = false;
            }
          })(),
        ]);
        this.cost.close(providerFinalized);
        this.ctx.ui.setStatus("bruv-live-cost", undefined);
        return { stopped: errors.length === 0, errors, jobsUnchanged: true as const };
      })().finally(() => {
        if (stoppingRun === this) stoppingRun = undefined;
      });
      return this.stopping;
    }
    async start(key: string) {
      let stage = "main-owner";
      try {
        this.owner = await deps.owner(pi, this.ctx, {
          onContext: (text, options) => this.deliverOwnerContext(text, options),
          onInput: (text) => this.deliverOwnerContext(text),
          onMessage: (message) => presentCanonicalVoiceMessage(this.ctx.sessionManager, message),
          onError: (message) => this.fail(message),
          signal: this.controller.signal,
        });
        if (!this.alive) {
          this.owner.close();
          return;
        }
        const orchestration = this.owner.orchestration;
        if (this.model === OPENAI_LIVE_MODEL) this.owner.delegatedVoice = true;
        stage = "audio-helper";
        const audio = await this.launchAudio();
        if (!audio || !this.alive) return;
        stage = "provider-construction";
        const provider =
          this.model === OPENAI_LIVE_MODEL
            ? this.configureDelegatedConversation()
            : this.configureToolConversation(orchestration);
        if (this.inputMode === "push-to-talk" && (!audio.setCaptureGate || !this.voice?.endAudio))
          throw new Error("Push-to-talk controls unavailable");
        stage = "provider-connect";
        await provider.connect(key);
        if (!this.alive) return;
        if (provider.state !== "ready") {
          this.fail("Provider did not accept session");
          return;
        }
        for (const update of this.initialContext) {
          if (!this.sendProviderContext(update.text, update.options))
            throw new Error("GPT-Live initial context capacity reached");
        }
        this.initialContext = [];
        this.initialContextBytes = 0;
        if (!this.alive) return;
        this.state = "running"; // capture may arrive synchronously inside audio.start()
        stage = "audio-start";
        if (this.inputMode === "push-to-talk") {
          if (!audio.setCaptureGate) throw new Error("Push-to-talk capture gate is unavailable");
          await audio.setCaptureGate(null);
        }
        await audio.start();
        if (!this.alive) return;
        if (this.gpt) this.gptPlayback?.start();
        else this.playback.start();
        if (!this.alive) return;
        this.editorTimer = setInterval(() => this.render(true), 80);
        this.editorTimer.unref?.();
        this.render(true);
      } catch {
        this.audioLaunchPending = false;
        if (this.alive)
          this.fail(
            stage === "main-owner"
              ? "Cannot start main Live. Wait for the text turn to finish, then retry /live. If it persists, restart Bruv; the ordinary prompt/runtime could not be acquired."
              : this.audio
                ? `Voice startup failed [${stage}]; details withheld`
                : audioLaunchDiagnostic(),
          );
      }
    }
    private deliverOwnerContext(text: string, options?: { triggerResponse?: boolean }) {
      if (!this.alive) return;
      // Already heard/produced by the frontend; persist for the coder without echoing it.
      if (text.startsWith('{"source":"gpt_live_provisional"')) return;
      if (this.gpt?.state === "ready" || this.voice?.state === "ready") {
        if (this.gpt) this.gptBridge?.saveContext(Math.floor(this.gptCaptureMs));
        if (!this.sendProviderContext(text, options))
          this.fail("GPT-Live context delivery capacity reached; reconnect voice. Coding work is unchanged.");
      } else {
        this.initialContextBytes += Buffer.byteLength(text);
        if (this.initialContextBytes > 1_048_576) throw new Error("Initial Live context exceeds 1 MiB; resume in text");
        this.initialContext.push({ text, options });
      }
    }
    // Live delivery and startup replay use the same provider protocol, but only live
    // delivery adds a delegation context snapshot (before sending the observation).
    private sendProviderContext(text: string, options?: { triggerResponse?: boolean }): boolean {
      if (this.gpt) {
        for (const chunk of gptLiveContext(text)) {
          if (!this.gpt.observation(chunk, options?.triggerResponse === true)) return false;
        }
      } else this.voice?.sendContext?.(text, options);
      return true;
    }
    private async launchAudio(): Promise<NativeAudio | undefined> {
      // Hello does not open devices. Provider setup must succeed BEFORE audio.start().
      this.audioLaunchPending = true;
      this.audio = await deps.audio(
        {
          capture: (pcm, epoch) => {
            if (
              this.alive &&
              this.state === "running" &&
              (this.inputMode === "continuous" || (this.heldEpoch !== null && epoch === this.heldEpoch))
            ) {
              this.inputFrames++;
              if (this.gpt) {
                const transition = this.gptPlayback?.capture(pcm);
                if (transition === "started") {
                  this.gptSpeechEpoch++;
                  this.gptBridge?.interrupt();
                  this.owner?.interrupt();
                  this.transcriptLog.finish("Voice", "interrupted");
                }
                this.gpt.appendMicrophone(pcm);
                this.gptCaptureMs += pcm.length / 32;
              } else this.voice?.sendAudio(pcm.toString("base64"));
              this.render();
            }
          },
          played: (ms) => {
            if (this.alive) {
              this.queuedMs = ms;
              if (ms > 0) this.heardQueue = true;
              this.playback.nativeQueued(ms);
              this.drain();
              this.render();
            }
          },
          error: (code, _message, detail) => this.fail(audioDiagnostic(code, detail)),
          closed: () => {
            if (this.alive) this.fail(audioDiagnostic("helper_failure"));
          },
        },
        this.controller.signal,
      );
      this.audioLaunchPending = false;
      if (!this.alive) {
        await this.audio.stop().catch(() => {});
        try {
          await this.audio.close();
        } catch {
          /* late launch already aborted */
        }
        this.audio = undefined;
        return undefined;
      }
      return this.audio;
    }
    private configureDelegatedConversation(): GPTLiveSession {
      this.gptCaptureMs = 0;
      this.gptBridge = new GptLiveDelegationBridge({
        context: () => ({
          sessionId: this.sessionId,
          selectedModel: this.ctx.model?.id,
          cwd: this.ctx.cwd,
        }),
        submitContextual: async (id, snapshot) => {
          if (!this.alive || !this.owner?.delegate) return { clarification: true };
          const speech = gptLiveRequest(snapshot);
          if (!speech) return { clarification: true };
          const speechEpoch = this.gptSpeechEpoch;
          // Admission precedes completion; do not await long-running work on the socket callback.
          let admitted = false;
          const operation = this.owner.delegate(id, speech, snapshot, () => {
            admitted = true;
            this.gptAdmittedUserText = speech;
            this.transcriptLog.finish("You", "turn-boundary");
          });
          if (!admitted) {
            void operation.catch(() => {});
            return { clarification: true };
          }
          void operation.then(
            () => {
              if (this.alive && this.gptSpeechEpoch === speechEpoch)
                this.gpt?.commentary(id, "Coding-agent turn ended. Read session history for its result.");
            },
            () => {
              if (this.alive)
                this.gpt?.commentary(id, "Coding-agent delegation failed. Check session history before retrying.");
            },
          );
          return { queued: true };
        },
      });
      this.gptPlayback = new GptLivePlaybackRecovery({
        send: (frame, epoch) =>
          this.audio ? this.audio.play(frame, epoch) : Promise.reject(new Error("Audio unavailable")),
        flush: (epoch) => (this.audio ? this.audio.flush(epoch) : Promise.reject(new Error("Audio unavailable"))),
        onError: () => this.fail("GPT-Live playback failed"),
        onState: (state) => {
          if (!this.alive) return;
          this.speaking = state.pendingBytes > 0 || state.inFlight || state.nativeQueuedMs > 0;
          this.render();
        },
      });
      this.gpt = (deps.gptSession ?? ((callbacks) => new GPTLiveSession(callbacks)))({
        onInputTranscript: (fragment) => {
          if (!this.alive) return;
          if (this.gptTranscriptIdle) clearTimeout(this.gptTranscriptIdle);
          this.gptTranscriptIdle = undefined;
          this.gptBridge?.addFragment({ ...fragment, text: fragment.delta });
          this.owner?.sendContext(
            JSON.stringify({
              source: "gpt_live_provisional",
              role: "user",
              ...fragment,
              uncertain: true,
            }),
            { customType: "live-transcript" },
          );
          this.transcriptLog.receive("You", { text: fragment.delta, finished: false });
          this.render();
        },
        onOutputTranscript: (fragment) => {
          if (!this.alive) return;
          this.owner?.sendContext(
            JSON.stringify({
              source: "gpt_live_provisional",
              role: "assistant",
              ...fragment,
              uncertain: true,
              playbackVerified: false,
            }),
            { customType: "live-transcript" },
          );
          this.transcriptLog.receive("Voice", { text: fragment.delta, finished: false });
          this.noteGptTranscriptActivity();
          this.render();
        },
        onDelegation: (event) => {
          if (!this.alive) return;
          void this.gptBridge?.handleCreated(event).then((result) => {
            if (this.alive && result?.kind === "queued") this.gpt?.commentary(event.id, result.commentary);
            else if (this.alive && result?.kind === "clarification") this.gpt?.commentary(event.id, result.commentary);
          });
        },
        onAudio: (pcm) => {
          if (this.alive) {
            this.gptPlayback?.output(Buffer.from(pcm));
            this.noteGptTranscriptActivity();
          }
        },
        onUsage: (usage) => this.cost.usage(usage),
        onError: (message) => this.fail(message),
        onClosed: (finalized, usage) => {
          if (usage !== undefined) this.cost.usage(usage);
          this.cost.close(finalized);
          if (this.alive) this.fail("GPT-Live provider closed");
        },
      });
      return this.gpt;
    }
    private configureToolConversation(orchestration: VoiceOrchestration): NativeVoice {
      this.voice = deps.voice(
        {
          onAudio: (pcm, epoch) => this.output(pcm, epoch),
          onUsage: (usage, id) => this.cost.usage(usage, id),
          getPlayedAudioMs: () => this.playback.playedMs,
          onInterrupted: (epoch) => this.interrupt(epoch),
          onInteractionStatus: (status) => {
            if (!this.alive) return;
            this.thinking = status === "IN_PROGRESS";
            this.render();
          },
          onTurnComplete: () => {
            if (this.provider === "google") this.cost.turnComplete();
            if (this.alive) {
              this.owner?.turnComplete();
              this.outputUtterance = "";
              this.transcriptLog.finish("Voice", "turn-boundary");
              this.transcriptLog.finish("You", "partial");
              this.turns++;
              this.generationFinished = true;
              this.playback.turnComplete(this.generation);
              this.drain();
              this.render();
            }
          },
          onInputActivity: () => {
            if (!this.alive) return;
            this.owner?.beginInput?.();
            this.inputUtterance = "";
            this.transcriptLog.finish("You", "partial");
          },
          onInputTranscript: (t) => {
            if (!this.alive) return;
            // Provider deltas are drafts, not final user instructions. OpenAI
            // completed ASR and model-contract Gemini envelopes replace the draft.
            this.inputUtterance =
              this.provider === "openai" || t.replace || t.finalitySource === "model_contract"
                ? t.text
                : this.inputUtterance + t.text;
            this.owner?.inputTranscript(this.inputUtterance, t.finished === true);
            if (t.finished) {
              this.completedInputTranscripts++;
              this.inputUtterance = "";
            }
            this.transcriptLog.receive("You", {
              ...t,
              replace: t.replace || t.finalitySource === "model_contract",
            });
            this.render();
          },
          onOutputTranscript: (t) => {
            if (!this.alive) return;
            this.outputUtterance =
              t.replace || t.finalitySource === "model_contract" ? t.text : this.outputUtterance + t.text;
            this.owner?.outputTranscript(this.outputUtterance, t.finished === true && !t.interrupted);
            if (t.finished && !t.interrupted) this.outputUtterance = "";
            if (t.interrupted) {
              this.owner?.interrupt();
              this.outputUtterance = "";
            }
            this.transcriptLog.receive(
              "Voice",
              t.interrupted
                ? { ...t, finished: false }
                : { ...t, replace: t.replace || t.finalitySource === "model_contract" },
            );
            if (t.interrupted) this.transcriptLog.finish("Voice", "interrupted");
            this.render();
          },
          // Realtime messages are locally classified; raw transport/provider text never crosses this boundary.
          onError: (e) => this.fail(`Provider ${e.code}${this.provider === "openai" ? `: ${e.message}` : ""}`),
        },
        orchestration,
        this.provider,
        this.model,
        this.inputMode,
      );
      return this.voice;
    }
  }
  registerLiveStop(pi, async (request) => {
    const run = current ?? stoppingRun;
    const sessionId = request.sessionManager?.getSessionId?.();
    if (
      !run ||
      !sessionId ||
      run.sessionId !== sessionId ||
      run.ctx.sessionManager !== request.sessionManager ||
      run.ctx.sessionManager?.getSessionFile?.() !== request.sessionManager?.getSessionFile?.()
    )
      return { stopped: false, errors: ["No Live voice session belongs to this agent session"], jobsUnchanged: true };
    return run.stopObserved();
  });
  pi.registerCommand("live", {
    description: "Voice (paid): start, stop, status, model, provider, setup, input, mic-check, speaker-check.",
    getArgumentCompletions: (prefix) => {
      const matches = [
        "start",
        "stop",
        "setup",
        "status",
        "provider",
        "model",
        "input",
        "mic-check",
        "speaker-check",
      ].filter((value) => value.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      if (!loaded) {
        try {
          if (!loading) loading = deps.config.load();
          selected = await loading;
          loaded = true;
        } catch {
          ctx.ui.notify("Could not read Live settings; selection unchanged. Fix settings before using Live.", "error");
          loading = undefined;
          return;
        }
      }
      const active = current || stoppingRun || entry || confirmation !== undefined || probe || speakerProbe || saving;
      const action = args.trim() || (active ? "stop" : "start");
      if (action === "status") {
        ctx.ui.notify(
          current
            ? "Live " +
                (current.state === "running"
                  ? current.speaking
                    ? "speaking"
                    : current.thinking
                      ? "thinking"
                      : "listening"
                  : "connecting") +
                " · " +
                LIVE_PROVIDERS[current.provider].label +
                " voice model " +
                current.model +
                " · " +
                current.inputState +
                " · input " +
                current.inputFrames +
                " frames · output " +
                Math.floor(current.outputBytes / 48) +
                "ms · queued " +
                Math.round(current.queuedMs) +
                "ms · turns " +
                current.turns +
                " · provider interruptions " +
                (current.voice?.diagnostics?.serverInterruptions ?? "unknown") +
                " · main owner " +
                (current.owner ? "connected" : "unavailable") +
                " · tools configured " +
                (current.owner?.orchestration.tools.length ?? 0) +
                " · completed input transcripts " +
                current.completedInputTranscripts +
                " · native VP " +
                (current.audio?.diagnostics.ready
                  ? (current.audio.diagnostics.ready.voiceProcessingEnabled ? "enabled" : "disabled") +
                    "/" +
                    (current.audio.diagnostics.ready.voiceProcessingBypassed ? "bypassed" : "unbypassed") +
                    " (configuration only, AEC unmeasured)"
                  : "unknown")
            : speakerProbe
              ? "Local speaker check running; provider not connected."
              : probe
                ? "Local mic check running; provider not connected."
                : entry
                  ? "Live setup."
                  : "Live off · " +
                    LIVE_PROVIDERS[selected.provider].label +
                    " voice model " +
                    selected.model +
                    " · " +
                    (selected.inputMode ?? "push-to-talk") +
                    ".",
          "info",
        );
      } else if (action === "input" || action.startsWith("input ")) {
        if (active) {
          ctx.ui.notify("Stop Live before changing mic mode.", "info");
          return;
        }
        const owner = ++sequence;
        const requested = action.slice("input".length).trim();
        if (requested && requested !== "push-to-talk" && requested !== "continuous") {
          ctx.ui.notify("Usage: /live input [push-to-talk|continuous]", "info");
          return;
        }
        const picked =
          requested ||
          (await ctx.ui.select("Live mic mode", [
            "Push-to-talk — hold Space; audio discarded while muted",
            "Continuous — always send mic audio while Live is on",
          ]));
        const mode =
          picked?.startsWith("Push-to-talk") || picked === "push-to-talk"
            ? "push-to-talk"
            : picked?.startsWith("Continuous") || picked === "continuous"
              ? "continuous"
              : undefined;
        if (!mode || owner !== sequence || current || stoppingRun || entry || saving) return;
        const next = { ...selected, inputMode: mode } as LiveConfig;
        saving = true;
        try {
          await deps.config.save(next);
        } catch {
          ctx.ui.notify("Could not save mic mode; previous choice kept.", "error");
          return;
        } finally {
          saving = false;
        }
        if (owner !== sequence) return;
        selected = next;
        ctx.ui.notify(`Live mic: ${mode}.`, "info");
      } else if (action === "provider" || action.startsWith("provider ")) {
        if (active) {
          ctx.ui.notify("Live is busy; stop it before configuring voice providers.", "info");
          return;
        }
        const requested = action.slice("provider".length).trim();
        const providers = ["google", "openai"] as const;
        if (requested && !providers.includes(requested as LiveProviderId)) {
          ctx.ui.notify("Usage: /live provider [google|openai]", "info");
          return;
        }
        const controller = new AbortController();
        entry = controller;
        const owner = ++sequence;
        const sessionId = ctx.sessionManager?.getSessionId?.();
        const leafId = ctx.sessionManager?.getLeafId?.();
        const alive = () =>
          entry === controller &&
          owner === sequence &&
          !controller.signal.aborted &&
          sessionId === ctx.sessionManager?.getSessionId?.() &&
          leafId === ctx.sessionManager?.getLeafId?.();
        try {
          const options = providers.map((id) => LIVE_PROVIDERS[id].label);
          const picked = requested || (await ctx.ui.select("Configure Live provider credentials", options));
          const provider = requested
            ? (requested as LiveProviderId)
            : providers[(options as string[]).indexOf(picked ?? "")];
          if (!provider || !alive()) return;
          const credentials = await deps.credentials(controller.signal, provider);
          if (!alive()) return;
          if (provider === "google") await runLiveSetup(ctx.ui, credentials, controller.signal, undefined, false);
          else await runOpenAISetup(ctx.ui, credentials, controller.signal, false);
        } catch {
          if (alive()) ctx.ui.notify("Could not check provider credentials. Try /live provider again.", "warning");
        } finally {
          if (entry === controller) entry = undefined;
        }
      } else if (action === "model" || action.startsWith("model ")) {
        if (active) {
          ctx.ui.notify("Live is busy; stop it before changing voice model.", "info");
          return;
        }
        const owner = ++sequence;
        const requested = action.slice("model".length).trim();
        const providers = ["google", "openai"] as const;
        const models = providers.flatMap((provider) =>
          LIVE_PROVIDERS[provider].models.map((model) => ({ provider, model })),
        );
        let choice = models.find(({ model }) => model === requested);
        if (requested && !choice) {
          ctx.ui.notify(`Unsupported Live voice model: ${clean(requested).slice(0, 100)}`, "error");
          return;
        }
        if (!requested) {
          const readiness: Record<LiveProviderId, string> = { google: "setup needed", openai: "setup needed" };
          for (const provider of providers) {
            try {
              const status = await (await deps.credentials(new AbortController().signal, provider)).status();
              readiness[provider] =
                status.state === "stored_api_key" || status.state === "configured_api_key"
                  ? "key configured"
                  : status.state === "oauth"
                    ? "API key needed (OAuth)"
                    : "setup needed";
            } catch {
              readiness[provider] = "readiness unknown";
            }
            if (owner !== sequence || current || entry || probe || speakerProbe || confirmation !== undefined) return;
          }
          const options = models.map(
            ({ provider, model }) =>
              model +
              " · " +
              LIVE_PROVIDERS[provider].label +
              " · " +
              readiness[provider] +
              (selected.model === model ? " (selected)" : ""),
          );
          const picked = await ctx.ui.select("Live voice model", options);
          choice = models[options.indexOf(picked ?? "")];
        }
        if (
          !choice ||
          owner !== sequence ||
          current ||
          stoppingRun ||
          entry ||
          confirmation !== undefined ||
          probe ||
          speakerProbe ||
          saving
        )
          return;
        const next: LiveConfig = {
          ...selected,
          provider: choice.provider,
          model: choice.model,
        };
        saving = true;
        try {
          await deps.config.save(next);
        } catch {
          ctx.ui.notify("Could not persist Live selection; previous choice kept.", "error");
          return;
        } finally {
          saving = false;
        }
        if (owner !== sequence) return;
        selected = next;
        ctx.ui.notify(`Live voice: ${LIVE_PROVIDERS[selected.provider].label} · ${selected.model}.`, "info");
      } else if (action === "mic-check") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Mic check requires a local interactive terminal.", "warning");
          return;
        }
        if (current || stoppingRun || entry || confirmation !== undefined || probe || speakerProbe) {
          ctx.ui.notify("Live is busy; stop it first.", "info");
          return;
        }
        const owner = ++sequence;
        confirmation = owner;
        let consent = false;
        try {
          consent = await ctx.ui.confirm(
            "Mic check",
            "Open microphone and speakers briefly? No playback, provider or agent tools. Audio is discarded, not saved or sent. macOS may ask for microphone access.",
          );
        } catch {
          /* dialog closed */
        }
        if (confirmation !== owner || owner !== sequence) return;
        confirmation = undefined;
        if (!consent) return;
        const controller = new AbortController();
        probe = controller;
        let audio: NativeAudio | undefined;
        let code: string | undefined;
        let setup: AudioSetupError | undefined;
        try {
          audio = await deps.audio(
            {
              error: (value, _message, detail) => {
                code = value;
                setup = detail;
              },
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          await audio.start();
          if (!controller.signal.aborted)
            ctx.ui.notify(
              code ? `Mic check: ${audioDiagnostic(code, setup)}` : "Audio route ready. Sound quality not measured.",
              code ? "warning" : "info",
            );
        } catch {
          if (!controller.signal.aborted)
            ctx.ui.notify(
              "Mic check: " +
                (code
                  ? audioDiagnostic(code, setup)
                  : audio
                    ? audioDiagnostic("helper_failure")
                    : audioLaunchDiagnostic()),
              "warning",
            );
        } finally {
          if (audio) {
            await audio.stop().catch(() => {});
            audio.close();
          }
          if (probe === controller) probe = undefined;
        }
      } else if (action === "speaker-check") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Speaker check requires a local interactive terminal.", "warning");
          return;
        }
        if (current || stoppingRun || entry || confirmation !== undefined || probe || speakerProbe) {
          ctx.ui.notify("Live is busy; stop it first.", "info");
          return;
        }
        const owner = ++sequence;
        confirmation = owner;
        let consent = false;
        try {
          consent = await ctx.ui.confirm(
            "Speaker check",
            "Play a quiet test sound and briefly open the microphone? Lower speaker volume and stay quiet. Local only: no provider or agent tools. Audio stays in memory and is discarded.",
          );
        } catch {
          /* dialog closed */
        }
        if (confirmation !== owner || owner !== sequence) return;
        confirmation = undefined;
        if (!consent) return;
        const controller = new AbortController();
        speakerProbe = controller;
        try {
          const summary = await deps.speakerCheck({ audio: deps.audio, signal: controller.signal });
          if (!controller.signal.aborted && speakerProbe === controller)
            ctx.ui.notify(
              "Speaker check (local; provider not connected): " +
                clean(summary).slice(0, 1800) +
                " This test cannot prove barge-in or AEC quality.",
              "info",
            );
        } catch {
          if (!controller.signal.aborted && speakerProbe === controller)
            ctx.ui.notify(
              "Speaker check failed; provider not connected. Check microphone access and the selected devices, or try /live mic-check.",
              "warning",
            );
        } finally {
          if (speakerProbe === controller) speakerProbe = undefined;
        }
      } else if (action === "stop") {
        probe?.abort();
        speakerProbe?.abort();
        sequence++;
        entry?.abort();
        entry = undefined;
        confirmation = undefined;
        const stopSessionId = ctx.sessionManager?.getSessionId?.();
        const result = await (current ?? stoppingRun)?.stopObserved();
        if (stopSessionId !== ctx.sessionManager?.getSessionId?.()) return;
        ctx.ui.notify(
          result && !result.stopped ? stopWarning(result.errors) : "Live off.",
          result && !result.stopped ? "warning" : "info",
        );
      } else if (action === "start" || action === "setup") {
        if (!deps.local(ctx.mode)) {
          ctx.ui.notify("Live requires a local interactive macOS or Linux terminal.", "warning");
          return;
        }
        if (current || stoppingRun || entry || confirmation !== undefined || probe || speakerProbe || saving) {
          ctx.ui.notify("Live is already active. Use /live stop first.", "info");
          return;
        }
        if ((selected.inputMode ?? "push-to-talk") === "push-to-talk" && ctx.mode !== "tui") {
          ctx.ui.notify(
            "Hold Space needs the local terminal editor. This frontend has no hold controls. Use the terminal, or explicitly choose /live input continuous.",
            "warning",
          );
          return;
        }
        if ((selected.inputMode ?? "push-to-talk") === "push-to-talk" && selected.model === OPENAI_LIVE_MODEL) {
          ctx.ui.notify(
            "GPT-Live has no manual input-turn control. Choose a Gemini or Realtime model for push-to-talk, or explicitly choose /live input continuous.",
            "warning",
          );
          return;
        }
        const controller = new AbortController();
        entry = controller;
        const owner = ++sequence;
        const entrySessionId = ctx.sessionManager?.getSessionId?.();
        const entryLeafId = ctx.sessionManager?.getLeafId?.();
        const alive = () =>
          entry === controller &&
          owner === sequence &&
          !controller.signal.aborted &&
          entrySessionId === ctx.sessionManager?.getSessionId?.() &&
          entryLeafId === ctx.sessionManager?.getLeafId?.();
        try {
          let key: string | undefined;
          if (action === "start") {
            try {
              key = await deps.key(controller.signal, selected.provider);
            } catch {
              // Missing or incompatible auth gets focused setup, never a raw provider error.
            }
          }
          if (!alive()) return;
          if (!key) {
            const credentials = await deps.credentials(controller.signal, selected.provider);
            if (!alive()) return;
            const start =
              selected.provider === "google"
                ? await runLiveSetup(ctx.ui, credentials, controller.signal)
                : await runOpenAISetup(ctx.ui, credentials, controller.signal);
            if (!alive() || !start) return;
            key = await credentials.loadKey(controller.signal);
          }
          if (!alive()) return;
          entry = undefined;
          const run = new Run(ctx);
          current = run;
          run.render(true);
          await run.start(key);
          if (run.alive && run.inputMode === "continuous")
            ctx.ui.notify("Live continuous mic: all captured audio is sent. /live stop to end.", "info");
        } catch {
          if (alive())
            ctx.ui.notify(
              `Could not read ${LIVE_PROVIDERS[selected.provider].label} API key. Try /live setup.`,
              "warning",
            );
        } finally {
          if (entry === controller) entry = undefined;
        }
      } else if (action)
        ctx.ui.notify("Usage: /live [start|setup|stop|status|provider|model|input|mic-check|speaker-check]", "info");
    },
  });
  // Navigation must wait for cancellation/results before Pi moves the branch.
  const stopForNavigation = async () => {
    const run = current;
    if (!run) return;
    run.owner?.stopForeground();
    await run.stopObserved();
    await run.owner?.released;
  };
  pi.on("session_before_tree", stopForNavigation);
  pi.on("session_before_fork", stopForNavigation);
  pi.on("session_before_switch", stopForNavigation);
  pi.on("session_shutdown", async () => {
    sequence++;
    entry?.abort();
    entry = undefined;
    confirmation = undefined;
    probe?.abort();
    speakerProbe?.abort();
    await stopForNavigation();
  });
  pi.on("session_start", (_event, ctx) => {
    conversationCtx = ctx;
    sequence++;
    entry?.abort();
    entry = undefined;
    confirmation = undefined;
    probe?.abort();
    speakerProbe?.abort();
    current?.stop();
  });
}

/** OpenAI Live only accepts the canonical openai API key, never openai-codex OAuth. */
async function runOpenAISetup(
  ui: Pick<ExtensionContext["ui"], "select" | "notify">,
  credentials: LiveCredentialService,
  signal: AbortSignal,
  allowStart = true,
): Promise<boolean> {
  let explained = false;
  while (!signal.aborted) {
    const status = await credentials.status(signal);
    if (signal.aborted) return false;
    if (status.state === "stored_api_key" || status.state === "configured_api_key") {
      const choice = await ui.select(
        allowStart ? "OpenAI voice" : "OpenAI API key configured",
        allowStart ? ["Start voice", "Done"] : ["Done"],
      );
      return !signal.aborted && choice === "Start voice";
    }
    if (!explained) {
      ui.notify(
        "OpenAI Live requires a canonical openai provider API key in agent auth. ChatGPT subscriptions and openai-codex OAuth do not work. Use /login → Sign in with an API key → OpenAI, then /live setup. Never paste keys into chat.",
        "info",
      );
      explained = true;
    }
    const choice = await ui.select("OpenAI API key required", ["Recheck", "Cancel"]);
    if (signal.aborted || choice !== "Recheck") return false;
  }
  return false;
}
