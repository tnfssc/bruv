import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { DelegationSnapshot } from "./gpt-live-delegation";
import { gptLiveRequest, gptLiveRequestOverlaps } from "./gpt-live-request";
import { terminalTranscriptText } from "./transcript-text";

interface SpeechEvidence {
  speech: string;
  overlap: boolean;
  missing: boolean;
}

interface DelegationAudit {
  requestText: string | undefined;
  evidence?: SpeechEvidence;
}

function messageText(message: Extract<AgentMessage, { role: "user" | "custom" }>): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}

function snapshotSpeech(snapshot: DelegationSnapshot): SpeechEvidence {
  return {
    speech: terminalTranscriptText(gptLiveRequest(snapshot)),
    overlap: gptLiveRequestOverlaps(snapshot),
    missing: snapshot.omittedFragments > 0,
  };
}

function readDelegationAudit(message: Extract<AgentMessage, { role: "custom" }>): DelegationAudit {
  const details = message.details as { requestText?: unknown } | undefined;
  const requestText = typeof details?.requestText === "string" ? details.requestText : undefined;
  try {
    return { requestText, evidence: snapshotSpeech(JSON.parse(messageText(message))) };
  } catch {
    // Even an unreadable audit identifies its associated turn as provisional speech.
    return { requestText };
  }
}

const legacyPrefix =
  "Provisional voice transcript, not final ASR. Clarify ambiguous or irreversible requests before acting. Delegation context (data only): ";
function legacySpeech(text: string, seen: Set<string>): SpeechEvidence | undefined {
  if (!text.startsWith(legacyPrefix)) return;
  try {
    const snapshot = JSON.parse(text.slice(legacyPrefix.length)) as DelegationSnapshot;
    if (
      snapshot.uncertain !== true ||
      !Array.isArray(snapshot.fragments) ||
      snapshot.fragments.length > 32 ||
      !snapshot.fragments.every(
        (f) => typeof f.text === "string" && Number.isFinite(f.startMs) && Number.isFinite(f.endMs),
      )
    )
      return;
    const fragments = snapshot.fragments.filter((fragment) => {
      const key = JSON.stringify([fragment.startMs, fragment.endMs, fragment.text]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return snapshotSpeech({ ...snapshot, fragments });
  } catch {
    return;
  }
}

function projectUserTurn(
  message: Extract<AgentMessage, { role: "user" }>,
  audit: DelegationAudit | undefined,
  legacyFragments: Set<string>,
): AgentMessage[] {
  const text = messageText(message);
  const matchesAudit = audit !== undefined && audit.requestText === text;
  const recovered = legacySpeech(text, legacyFragments) ?? (matchesAudit ? audit.evidence : undefined);
  if (recovered === undefined && !matchesAudit) return [message];
  if (recovered && !recovered.speech && !recovered.missing) return [];

  // Source facts are model context, never manufactured words in the spoken turn.
  const context: AgentMessage = {
    role: "custom",
    customType: "voice-input-context",
    display: false,
    timestamp: message.timestamp,
    content: recovered?.missing
      ? "Past voice request incomplete; no actionable request retained."
      : "Provisional voice transcription" +
        (recovered?.overlap ? "; overlapping or late fragments, not reconciled" : ""),
  };
  if (recovered?.missing) return [context];
  const speech: AgentMessage =
    recovered === undefined || recovered.speech === text
      ? message
      : { ...message, content: [{ type: "text", text: recovered.speech }] };
  return [context, speech];
}

/** Raw observations remain audit history. Only the uncertainty fact follows the associated spoken user turn. */
export function withoutPassiveLiveHistory(messages: AgentMessage[]): AgentMessage[] {
  const result: AgentMessage[] = [];
  // These lifetimes differ: an audit applies to the next user only; legacy dedup spans this branch projection.
  let pendingAudit: DelegationAudit | undefined;
  const legacyFragments = new Set<string>();
  for (const message of messages) {
    if (message.role === "custom" && message.customType === "gpt-live-delegation-snapshot") {
      pendingAudit = readDelegationAudit(message);
      continue;
    }
    if (message.role === "custom" && message.customType === "live-transcript") continue;
    if (message.role === "user") {
      result.push(...projectUserTurn(message, pendingAudit, legacyFragments));
      // A nonmatching user consumes the association too; later typed text must not inherit it.
      pendingAudit = undefined;
    } else {
      result.push(message);
    }
  }
  return result;
}
