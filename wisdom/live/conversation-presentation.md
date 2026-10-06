# Conversation presentation piece

Worktree: /home/tnfssc/.bruv/worktrees/t3-7231ab8c-5442693331ce-task_7d11acb0

Read parent voice-cli-research/findings.md and wisdom/values.md in /home/tnfssc/.t3/worktrees/bruv/t3-7231ab8c. Followed their shared ordinary-conversation decision; no voice screen, fake focus button, commands, editor changes, or new participant.

Source decisions
- Direct Gemini/OpenAI: MainOwner's existing user/assistant/live-provisional entries remain canonical. New onMessage callback runs after durable/state commit, including deferred commits after the canonical tool result. presentCanonicalVoiceMessage emits only terminal subscriber events; no duplicate persistence, extension model hooks, or prompt.
- Paired GPT: retain the existing hidden per-delta live-transcript JSON records unchanged, including timing/uncertainty. markPassiveConversationTranscript saves only an empty presentation marker with speaker, status, group ID and source length. Renderer reads the preceding original fragments from that same branch. No copied reply text and no new coding turn.
- MainOwner.saveTranscript is passive-only, unlike sendContext: never forwards to provider context; paired records use Pi's triggerTurn:false deferred queue. Both source fragments and markers remain excluded by existing withoutPassiveLiveHistory.
- Native UserMessageComponent / AssistantMessageComponent supply actual styling; partial/interrupted/suppressed and playback-unverified facts are muted footers. Internal persisted You/Voice discriminators remain compatible, but no Voice participant/custom label/JSON is rendered.

Exact parent wiring (extension-owned; not changed here)

```ts
import { registerConversationRenderers, presentCanonicalVoiceMessage,
  markPassiveConversationTranscript, savePassiveConversationTranscript } from "./conversation";

// At extension registration, before replay; use the current session, not a stale run.
let conversationCtx: ExtensionContext | undefined;
pi.on("session_start", (_event, ctx) => { conversationCtx = ctx; });
registerConversationRenderers(pi, () =>
  conversationCtx?.sessionManager.getBranch().filter(e => e.type === "custom_message") ?? []);

// LiveControl: replace its view-only TranscriptLog constructor.
readonly transcriptLog = new TranscriptLog(entry => {
  const owner = this.owner;
  if (!owner) return;
  if (owner.delegatedVoice) {
    // Ordinary delegate()/prompt() already renders the authorized spoken user once.
    markPassiveConversationTranscript(owner, entry, entry.speaker === "Voice");
  } else if (entry.superseded) {
    // A replaced draft is audit-only, not another authoritative/user-visible turn.
    savePassiveConversationTranscript(owner, entry, false);
  }
}, { groupTurns: true });

// Add to deps.owner(pi, this.ctx, { ...existing callbacks... }):
onMessage: message => presentCanonicalVoiceMessage(this.ctx.sessionManager, message),

// Replace transcriptLog.view(clean) in the active viewport:
const visible = this.transcriptLog.draftView(clean).slice(-MAX_VISIBLE);
```

Keep both existing GPT raw owner.sendContext(JSON.stringify(fragment), {customType:"live-transcript"}) calls BEFORE transcriptLog.receive: the marker references those source records. Do not call savePassiveConversationTranscript for the same GPT source as well. Direct canonical finals must not also be sent through a transcript message sink. Keep existing stopObserved order (finish both logs before owner.close).

For direct input replacement, pass replace: t.replace || t.finalitySource === "model_contract" (current extension overwrites OpenAI's replace flag). For grouped assistant replacement, pass the same replacement fact when the provider truly supplies a whole replacement rather than a delta. No changes to provider finality/admission.

Boundaries and parent decisions
- Existing finish(speaker,status) is the simple boundary API. Explicit final transcripts clear drafts; interruption/turn-boundary/stop save uncertainty, not invented finality. No widget keeps completed rows after using draftView.
- GPT's current callback interface has provisional fragments but no final-turn callback. Parent must choose its local flush boundary for idle replies and call finish("Voice","turn-boundary"); never infer provider-final or hearing from a timer, timeline ACK, or queue drain. Without that wiring GPT replies remain active drafts until speaker change/interruption/stop.
- Hidden GPT user markers avoid duplicate provider-authorized ordinary user messages. Unadmitted GPT input remains preserved audit + active draft, not an invented finalized user instruction. Parent owns any different presentation policy.
- Native direct final assistant rendering is the ordinary produced-text rendering; persisted liveTranscript.playbackVerified remains false. Do not relabel these entries as heard. Grouped/provisional renderers explicitly annotate playback uncertainty.
- saveTranscript is optional in the injected MainOwner type for existing minimal test fixtures, always implemented by acquireMainOwner. Parent fixtures that exercise the new sink must implement it.

Checks
Bun install --frozen-lockfile; bun run prepare:assets; bunx tsc --noEmit. 41 tests passed across live-conversation, live-transcript, live-main-owner, live-passive-history, live-paired-runtime, and session-input (8 new conversation tests). Focused tests cover source persistence/reopen, full long text, actual native custom/user/assistant renderers, source-reference replay, replacement audit, deferred tool-pair ordering, real Pi passive delivery with zero provider streams, and existing paired runtime/finality/context tests. No provider/device/paid calls or keyboard/terminal hardware acceptance run. Parent still owns extension/editor integration and end-to-end terminal acceptance.
