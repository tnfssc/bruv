import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Activity, registerActivity } from "../src/activity";
import { registerAgents } from "../src/agents";
import { registerCheck } from "../src/check";
import { registerCodemode } from "../src/codemode";
import { registerCodexCompaction } from "../src/codex-compaction";
import { registerCodexImport } from "../src/codex-import";
import { registerCompact } from "../src/compact";
import { registerDeveloper } from "../src/developer";
import { registerEditor } from "../src/editor";
import { registerFast } from "../src/fast";
import { registerFinish } from "../src/finish";
import { registerFinishRender } from "../src/finish-render";
import { registerFooter } from "../src/footer";
import { registerGoal } from "../src/goal";
import { registerHome } from "../src/home";
import { Jobs, registerJobs } from "../src/jobs";
import { registerMigrate } from "../src/migrate";
import { registerNotes } from "../src/notes";
import { registerNotifications } from "../src/notify";
import { registerPatch } from "../src/patch";
import { registerPrompt } from "../src/prompt";
import { registerPs } from "../src/ps";
import { registerQuestions } from "../src/questions";
import { registerReasoning } from "../src/reasoning";
import { registerRender } from "../src/render";
import { registerReview } from "../src/review";
import { registerSettle } from "../src/settle";
import { registerTurn } from "../src/turn";
import { registerUI } from "../src/ui";
import { registerUsage } from "../src/usage";
import { registerVoice } from "../src/voice";
import { registerWeb } from "../src/web";

export default function bruv(pi: ExtensionAPI): void {
  // The web version is a different job, so it loads a different set. Pi sets flag values only after
  // extensions load, so this reads the command line.
  if (process.argv.includes("--web")) {
    web(pi);
    return;
  }
  const jobs = new Jobs();
  // Registered first so it wraps every other tool renderer.
  const activity = new Activity();
  registerActivity(pi, activity);
  registerUI(pi, jobs);
  registerPs(pi, jobs);
  activity.scripts = registerRender(pi);
  registerEditor(pi);
  registerCompact(pi);
  registerFooter(pi, jobs);
  registerHome(pi);
  registerFinishRender(pi);
  registerNotifications(pi);
  registerSettle(pi, jobs, () => hasFinished());
  registerJobs(pi, jobs);
  registerPatch(pi);
  const isFast = registerFast(pi);
  const startAgents = registerAgents(pi, jobs, isFast);
  const goal = registerGoal(pi, () => hasFinished());
  const answers = registerQuestions(pi);
  const check = registerCheck(pi, jobs, startAgents, undefined, goal, answers);
  const usage = registerUsage(pi, undefined, jobs);
  const summary = registerTurn(pi, jobs, usage);
  // Both change the request, so they run before compaction saves it for Codex compaction.
  registerDeveloper(pi);
  registerReasoning(pi);
  registerCodexCompaction(pi);
  const hasFinished = registerFinish(pi, undefined, check, () => !!goal.active(), summary);
  registerPrompt(pi);
  registerNotes(pi);
  registerCodemode(pi);
  registerCodexImport(pi);
  registerMigrate(pi);
  registerReview(pi);
  registerVoice(pi);
  registerWeb(pi);
}

/**
 * `pi --web`: the assistant that manages the user's T3 work. It doesn't code, so it leaves out what serves
 * coding (jobs, agents, goals, checks, finish, reviews, notes, apply_patch), which would also act on every run.
 */
function web(pi: ExtensionAPI) {
  const jobs = new Jobs();
  const activity = new Activity();
  registerActivity(pi, activity);
  registerUI(pi, jobs);
  activity.scripts = registerRender(pi);
  registerEditor(pi);
  registerCompact(pi);
  registerFooter(pi, jobs);
  registerDeveloper(pi);
  registerReasoning(pi);
  registerCodexCompaction(pi);
  registerCodemode(pi);
  registerWeb(pi);
}
