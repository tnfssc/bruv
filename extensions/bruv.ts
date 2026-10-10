import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgents } from "../src/agents";
import { registerCodemode } from "../src/codemode";
import { registerCodexCompaction } from "../src/codex-compaction";
import { registerFast } from "../src/fast";
import { registerGoal } from "../src/goal";
import { Jobs, registerJobs } from "../src/jobs";
import { registerPrompt } from "../src/prompt";
import { registerQuestions } from "../src/questions";
import { registerRace } from "../src/race";
import { registerRender } from "../src/render";
import { registerSettle } from "../src/settle";
import { registerUI } from "../src/ui";
import { registerUsage } from "../src/usage";

export default function bruv(pi: ExtensionAPI): void {
  const jobs = new Jobs();
  registerUI(pi, jobs);
  registerRender(pi);
  registerSettle(pi, jobs);
  registerJobs(pi, jobs);
  const isFast = registerFast(pi);
  const startAgents = registerAgents(pi, jobs, isFast);
  registerRace(pi, jobs, startAgents);
  registerUsage(pi);
  registerCodexCompaction(pi);
  registerQuestions(pi);
  registerGoal(pi);
  registerPrompt(pi);
  registerCodemode(pi);
}
