import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "../jobs";
import type { Call } from "./call";

/**
 * About half a minute of listening. Past it, `say` stops at the last whole sentence and asks the agent to
 * show the rest or confirm it must be heard: a soft check rather than a cap, since some things do need
 * saying in full, but long speech is slow, can't be skimmed and is usually better on screen.
 */
export const sayLimit = 70;

const words = (text: string) => text.match(/\S+/g)?.length ?? 0;

/** The text up to the last sentence that ends within `limit` words. */
export function within(text: string, limit = sayLimit) {
  let end = 0;
  for (const match of text.matchAll(/[.!?](?=\s|$)/g)) {
    const at = match.index + 1;
    if (words(text.slice(0, at)) > limit) break;
    end = at;
  }
  return text.slice(0, end);
}

/**
 * The `say` tool: the only way the agent's words reach the user's ears. Voice is a channel between the user
 * and the agent: what the user says arrives as a message, and the agent answers with `say`, so it decides
 * what is worth hearing instead of its whole transcript being read out.
 *
 * Speech starts while the call is still being written, a sentence at a time, so `say` is as quick as
 * reading the reply was. `execute` speaks whatever streaming didn't (a call made from a script, or a
 * provider that sends arguments at the end) and returns at once, so the agent works on while it plays.
 */
export class Speaker {
  /** How much of each call's text has been spoken, by tool call id. */
  private spoken = new Map<string, number>();
  private done = new Set<string>();
  /** Calls stopped at the limit, with what was spoken of them. */
  private cut = new Map<string, string>();

  constructor(private call: () => Call | undefined) {}

  /** The call's text so far, from the stream. `confirm` lifts the limit. */
  stream(id: string, text: string, confirm = false) {
    const call = this.call();
    if (!call || this.done.has(id)) return;
    const over = !confirm && words(text) > sayLimit;
    const allowed = over ? within(text) : text;
    const said = this.spoken.get(id);
    if (said === undefined) call.replyStart();
    if (allowed.length > (said ?? 0)) call.reply(allowed.slice(said ?? 0));
    this.spoken.set(id, Math.max(said ?? 0, allowed.length));
    if (!over) return;
    // A space ends the last allowed sentence, so it is said; the one being written is dropped.
    if (allowed.length >= (said ?? 0)) call.reply(" ");
    call.replyEnd(false);
    call.note("tool", "Too long to say aloud; the agent is asked to show it instead");
    this.done.add(id);
    this.cut.set(id, allowed);
  }

  /** The call is whole: says the rest. Safe to call again. */
  finish(id: string, text: string, confirm = false) {
    if (this.done.has(id)) return;
    this.stream(id, text, confirm);
    if (this.done.has(id)) return;
    this.call()?.replyEnd();
    this.done.add(id);
  }

  /** What was spoken of a call stopped at the limit, if it was. */
  stopped(id: string) {
    return this.cut.get(id);
  }

  forget(id: string) {
    this.spoken.delete(id);
    this.done.delete(id);
    this.cut.delete(id);
  }
}

export function registerSay(pi: ExtensionAPI, speaker: Speaker, onSay: () => void, listeners: () => string[]) {
  pi.registerTool({
    name: "say",
    label: "Say",
    description:
      "Say something to the user out loud. It is the only way they hear you while voice is on; your written replies are not read out. Call it directly, not from a script, so it starts speaking at once. Past about 70 words it stops at a sentence end and asks you to show the rest instead, unless confirm is true.",
    parameters: Type.Object({
      // Before text, so it streams first and the check knows in time.
      confirm: Type.Optional(
        Type.Boolean({ description: "True only when it really has to be heard in full, however long." }),
      ),
      text: Type.String({
        description:
          "Two or three plain sentences, as you'd say them: no Markdown, backticks, code, symbols, links, or file or function names. Say what a thing does instead.",
      }),
    }),
    outputSchema: Type.Object({ heardOn: Type.Array(Type.String()) }),
    async execute(id, args) {
      onSay();
      speaker.finish(id, args.text, args.confirm);
      const spoken = speaker.stopped(id);
      speaker.forget(id);
      const heardOn = listeners();
      if (!heardOn.length) throw new Error("No one can hear it: voice has nothing connected. Write it instead.");
      if (spoken !== undefined) {
        const count = words(args.text);
        const last = spoken.split(/(?<=[.!?])\s+/).at(-1);
        const heard = spoken ? `They heard up to: "${last}"` : "Nothing was spoken.";
        throw new Error(
          `That was ${count} words, about ${Math.round(count / 2.5)} seconds of listening, so it stopped early. ${heard} Show the rest with show and say a sentence about it, or, if it really has to be heard, call say again with confirm: true and only the part they haven't heard.`,
        );
      }
      return toolResult({ heardOn });
    },
  });
}
