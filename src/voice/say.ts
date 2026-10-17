import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "../jobs";
import type { Call } from "./call";

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

  constructor(private call: () => Call | undefined) {}

  /** The call's text so far, from the stream. */
  stream(id: string, text: string) {
    const call = this.call();
    if (!call || this.done.has(id)) return;
    const said = this.spoken.get(id);
    if (said === undefined) call.replyStart();
    if (text.length > (said ?? 0)) call.reply(text.slice(said ?? 0));
    this.spoken.set(id, Math.max(said ?? 0, text.length));
  }

  /** The call is whole: says the rest. Safe to call again. */
  finish(id: string, text: string) {
    if (this.done.has(id)) return;
    this.stream(id, text);
    this.call()?.replyEnd();
    this.done.add(id);
  }

  forget(id: string) {
    this.spoken.delete(id);
    this.done.delete(id);
  }
}

export function registerSay(pi: ExtensionAPI, speaker: Speaker, onSay: () => void, listeners: () => string[]) {
  pi.registerTool({
    name: "say",
    label: "Say",
    description:
      "Say something to the user out loud. It is the only way they hear you while voice is on; your written replies are not read out. Call it directly, not from a script, so it starts speaking at once.",
    parameters: Type.Object({
      text: Type.String({
        description:
          "Two or three plain sentences, as you'd say them: no Markdown, backticks, code, symbols, links, or file or function names. Say what a thing does instead.",
      }),
    }),
    outputSchema: Type.Object({ heardOn: Type.Array(Type.String()) }),
    async execute(id, args) {
      onSay();
      speaker.finish(id, args.text);
      speaker.forget(id);
      const heardOn = listeners();
      if (!heardOn.length) throw new Error("No one can hear it: voice has nothing connected. Write it instead.");
      return toolResult({ heardOn });
    },
  });
}
