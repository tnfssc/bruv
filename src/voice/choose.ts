import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cloudModel } from "./cloud";
import type { Cloud } from "./engine";

/** Shows a notice the first time only; a file in `dir` remembers it was shown. */
function once(context: ExtensionContext, dir: string, name: string, text: string) {
  if (!context.hasUI || existsSync(join(dir, name))) return;
  context.ui.notify(text, "info");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), "");
}

/**
 * Which voice speaks: a model on OpenRouter when Pi has an OpenRouter key, unless `speech` is "kokoro".
 * The first time, says so: what the agent says is sent to OpenRouter, and it costs a little.
 */
export async function chooseCloud(
  context: ExtensionContext,
  speech: string | undefined,
  dir: string,
): Promise<Cloud | undefined> {
  if (speech === "kokoro") return undefined;
  const key = () => context.modelRegistry.getApiKeyForProvider("openrouter");
  if (!(await key().catch(() => undefined))) {
    once(
      context,
      dir,
      "told-key",
      "Voice speaks with Kokoro. With an OpenRouter key (OPENROUTER_API_KEY or /login), it speaks with Fish Audio Drama 3 instead, which sounds like a person, for about 10¢ an hour of talk at its launch price.",
    );
    return undefined;
  }
  const model = speech ?? cloudModel;
  once(
    context,
    dir,
    "told-cloud",
    `Voice speaks with ${model} through your OpenRouter key. What the agent says aloud is sent there, for about 10¢ an hour of talk with Drama 3 at its launch price. To keep speech on this machine, set "speech": "kokoro" under "voice" in bruv.json.`,
  );
  return { model, key, fillers: join(dir, "fillers") };
}
