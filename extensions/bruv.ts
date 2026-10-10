import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgents } from "../src/agents";
import { registerCodemode } from "../src/codemode";
import { registerCodexCompaction } from "../src/codex-compaction";
import { registerFast } from "../src/fast";
import { registerGoal } from "../src/goal";
import { Jobs, registerJobs } from "../src/jobs";
import { registerPrompt } from "../src/prompt";
import { registerQuestions } from "../src/questions";
import { registerSettle } from "../src/settle";
import { registerUI } from "../src/ui";
import { registerUsage } from "../src/usage";

export default function bruv(pi: ExtensionAPI): void {
  const jobs = new Jobs();
  registerUI(pi, jobs);
  registerSettle(pi, jobs);
  registerJobs(pi, jobs);
  const isFast = registerFast(pi);
  registerAgents(pi, jobs, isFast);
  registerUsage(pi);
  registerCodexCompaction(pi);
  registerQuestions(pi);
  registerGoal(pi);
  registerPrompt(pi);
  registerCodemode(pi);
}
