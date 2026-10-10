import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgents } from "../src/agents";
import { registerCodemode } from "../src/codemode";
import { Jobs, registerJobs } from "../src/jobs";
import { registerPrompt } from "../src/prompt";
import { registerSettle } from "../src/settle";
import { registerUI } from "../src/ui";

export default async function bruv(pi: ExtensionAPI): Promise<void> {
  const jobs = new Jobs();
  registerUI(pi, jobs);
  registerSettle(pi, jobs);
  registerJobs(pi, jobs);
  registerAgents(pi, jobs);
  registerPrompt(pi);
  await registerCodemode(pi);
}
