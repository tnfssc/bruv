import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  getMarkdownTheme,
  type MessageRenderer,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { getInstructionContinuitySession } from "../agent/instruction-continuity";
import { type TranscriptEntry, VOICE_ENTRY } from "../session/transcript";
import type { MainOwner } from "./main-owner";
import { terminalTranscriptText } from "./transcript-text";

function textContent(message: { content: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/** Normalize persisted transcript formats, not provider instructions or participant identities. */
export type ConversationSource = { customType?: string; content?: unknown; details?: unknown };
type SourceGroup = Partial<TranscriptEntry> & { groupId?: string; sourceLength?: number };

/** Read a bounded-turn marker from its preceding canonical GPT fragment records. */
function sourceText(group: SourceGroup, source: readonly ConversationSource[]): string {
  const end = source.findIndex((entry) => (entry.details as SourceGroup | undefined)?.groupId === group.groupId);
  const role = group.speaker === "You" ? "user" : "assistant";
  const parts: string[] = [];
  let remaining = group.sourceLength ?? 0;
  for (let index = end - 1; index >= 0 && remaining > 0; index--) {
    const entry = source[index];
    if (entry.customType !== "live-transcript") continue;
    const details = entry.details as SourceGroup | undefined;
    if (details?.groupId && details.speaker === group.speaker) break;
    try {
      const fragment = JSON.parse(textContent({ content: entry.content }));
      if (fragment.role !== role || typeof fragment.delta !== "string") continue;
      const text = fragment.delta.slice(-remaining);
      parts.push(text);
      remaining -= text.length;
    } catch {
      /* A non-fragment custom entry is not received speech. */
    }
  }
  return parts.reverse().join("");
}

function transcript(
  message: Parameters<MessageRenderer>[0],
  source: readonly ConversationSource[] = [],
): TranscriptEntry | undefined {
  const text = textContent(message);
  const details = message.details as (SourceGroup & { kind?: string }) | undefined;
  if (details?.speaker === "You" || details?.speaker === "Voice") {
    return {
      speaker: details.speaker,
      text: details.groupId ? sourceText(details, source) : text,
      status: details.status ?? "partial",
      superseded: details.superseded,
    };
  }
  if (message.customType === "live-provisional" && details?.kind) {
    const prefix = details.kind + ": ";
    return {
      speaker: details.kind.includes("user") ? "You" : "Voice",
      text: text.startsWith(prefix) ? text.slice(prefix.length) : text,
      status: details.kind.startsWith("interrupted") ? "interrupted" : "partial",
    };
  }
  // Older GPT fragment records are audit data. If explicitly displayed, render
  // their received words rather than their JSON envelope or a custom-type label.
  if (message.customType === "live-transcript") {
    try {
      const fragment = JSON.parse(text);
      if (typeof fragment.delta === "string" && (fragment.role === "user" || fragment.role === "assistant"))
        return { speaker: fragment.role === "user" ? "You" : "Voice", text: fragment.delta, status: "partial" };
    } catch {
      /* Plain grouped text requires speaker details. */
    }
  }
  return undefined;
}

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "live" as AssistantMessage["api"],
    provider: "live",
    model: "live",
    timestamp: 0,
    stopReason: "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

/** The native user/assistant components own all conversation styling. No Voice participant. */
export function conversationTranscriptRenderer(
  source: () => readonly ConversationSource[] = () => [],
): MessageRenderer {
  return (message, options, theme) => {
    const entry = transcript(message, source());
    const result = new Container();
    // Never fall through to Pi's raw JSON/custom-label renderer for audit-only data.
    if (!entry || entry.superseded) return result;
    const markdownTheme = getMarkdownTheme();
    const text = terminalTranscriptText(entry.text);
    result.addChild(
      entry.speaker === "You"
        ? new UserMessageComponent(text, markdownTheme, options.outputPad)
        : new AssistantMessageComponent(assistant(text), false, markdownTheme, undefined, options.outputPad),
    );
    const facts: string[] = [];
    if (entry.status === "interrupted") facts.push("Interrupted");
    else if (entry.status === "suppressed") facts.push("Not played");
    else if (entry.status !== "final") facts.push("Partial transcript");
    if (facts.length) result.addChild(new Text(theme.fg("muted", facts.join(" · ")), options.outputPad, 0));
    return result;
  };
}

export const renderConversationTranscript = conversationTranscriptRenderer();

/** Register once in the ordinary extension, before live messages or session replay. */
export function registerConversationRenderers(
  pi: Pick<ExtensionAPI, "registerMessageRenderer">,
  source?: () => readonly ConversationSource[],
): void {
  const renderer = conversationTranscriptRenderer(source);
  for (const type of [VOICE_ENTRY, "live-provisional", "live-transcript"]) pi.registerMessageRenderer(type, renderer);
}

/** Only present an existing durable MainOwner record; never sendMessage/prompt or persist a copy.
 * Pi's terminal subscriber seam is the same pinned seam as MainOwner's tool presentation.
 * Delegate prompt output already emits its own events and must not pass through this helper.
 */
export function presentCanonicalVoiceMessage(manager: ExtensionContext["sessionManager"], message: AgentMessage): void {
  if (
    message.role !== "user" &&
    message.role !== "assistant" &&
    !(
      message.role === "custom" &&
      message.display &&
      [VOICE_ENTRY, "live-provisional", "live-transcript"].includes(message.customType)
    )
  )
    return;
  const session = getInstructionContinuitySession(manager) as { _emit?: (event: unknown) => void } | undefined;
  const shown =
    message.role === "custom"
      ? message
      : {
          ...message,
          content:
            typeof message.content === "string"
              ? terminalTranscriptText(message.content)
              : message.content.map((part) =>
                  part.type === "text" ? { ...part, text: terminalTranscriptText(part.text) } : part,
                ),
        };
  session?._emit?.({ type: "message_start", message: shown });
  session?._emit?.({ type: "message_end", message: shown });
}

/** Save a full passive source entry, e.g. a superseded direct draft.
 * Do not copy text already retained in canonical messages/fragments; use a marker for GPT.
 * live-transcript remains excluded from model context by the existing passive-history projection.
 */
export function savePassiveConversationTranscript(owner: MainOwner, entry: TranscriptEntry, display: boolean): void {
  owner.saveTranscript?.(
    entry.text,
    {
      speaker: entry.speaker,
      status: entry.status,
      superseded: entry.superseded,
      playbackVerified: false,
      uncertain: entry.status !== "final",
    },
    display && !entry.superseded,
  );
}

/** Preferred paired-GPT sink when raw fragment entries are already persisted.
 * Store only a presentation boundary, not a copy of received text. The renderer
 * reads the original fragments in the same branch; passive-history excludes both.
 * Source fragment appends must precede this boundary (sendCustomMessage preserves queue order).
 */
export function markPassiveConversationTranscript(owner: MainOwner, entry: TranscriptEntry, display: boolean): void {
  owner.saveTranscript?.(
    "",
    {
      groupId: randomUUID(),
      sourceLength: entry.text.length,
      speaker: entry.speaker,
      status: entry.status,
      superseded: entry.superseded,
      playbackVerified: false,
      uncertain: entry.status !== "final",
    },
    display && !entry.superseded,
  );
}
