import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodemode } from "../src/codemode";
import { registerPrompt } from "../src/prompt";

export default async function bruv(pi: ExtensionAPI): Promise<void> {
  registerPrompt(pi);
  await registerCodemode(pi);
}
