/** Explicit paid OpenAI Realtime text-input probe. No desktop reads, real tool dispatch or audio playback.
 * Setup: bun install --frozen-lockfile; bun scripts/prepare-assets.ts.
 * Run: BRUV_CAPABILITY_PROBE=1 bun scripts/probe-live-capability.ts --disclose-root baseline:jobs grounding:jobs
 * Output JSONL includes model-generated code: review before sharing. Never execute it.
 */
import { studyTrial } from "./live-study-trial";
import { createDefaultLiveCredentialService } from "../src/live/credentials";
import { loadLiveConfig } from "../src/live/config";
import { createPromptPreview } from "../src/prompt-preview";
import { createHash } from "node:crypto";

if (process.env.BRUV_CAPABILITY_PROBE !== "1") throw Error("Set BRUV_CAPABILITY_PROBE=1 for paid probe");
const args = process.argv.slice(2);
if (args[0] !== "--disclose-root")
  throw Error(
    "Pass --disclose-root: generated root (possibly local paths) will be sent to configured provider; output may echo private context",
  );
const requested = args.slice(1);
if (
  !requested.length ||
  requested.length > 24 ||
  requested.some((spec) => {
    const [v, scenario, extra] = spec.split(":");
    return (
      extra ||
      !["baseline", "grounding", "intent", "description"].includes(v) ||
      !["jobs", "naturalJobs", "naturalFile", "naturalAudio", "file", "audio", "weather", "correction"].includes(
        scenario,
      )
    );
  })
)
  throw Error("Pass 1–24 valid variant:scenario trials");
const config = await loadLiveConfig();
if (config.provider !== "openai")
  throw Error("This probe supports only configured OpenAI Live; found " + config.provider + "/" + config.model);
const service = await createDefaultLiveCredentialService(undefined, config.provider);
// Do not log credential metadata.
const key = await service.loadKey(); // Never log or serialize credentials.
// Offline production prompt assembly in an isolated synthetic session; excludes active project/history.
const preview = await createPromptPreview({ rootMode: "orchestrator", message: "Synthetic Live capability probe" });
const root = preview.systemPrompt;
const guidance =
  "\n\nYou are the same main Bruv agent in Live. Your execute tool is available in this voice turn. It runs JavaScript in the Bruv host; jobs.list(), shell(), and subagent() are host helpers inside execute, not direct function names. If the user asks for an action, call execute to perform the authorized action before reporting its result. Do not infer inability from the audio interface. If a tool has not run, say so; do not claim work completed. For audio cleanup, delegate to a worker using subagent through execute rather than asking the user to run a command.";
const intention =
  "\n\nWhen an authorized request asks you to do something, select the needed execute call now instead of describing a command. Only a tool response confirms an action happened. If you just refused because you thought you lacked filesystem, shell, or audio-processing ability, reassess the available execute tool and attempt the safe requested action. Voice input/output does not remove host tools.";
const description =
  "Run JS/TS code in the host's current directory. Top-level await works. Use await jobs.list() for jobs; await shell(command) for shell; await subagent({type:'normal',prompt:'...'}) to delegate tasks including audio cleanup. Calls execute in the real app; this probe mocks results and never executes generated code.";
const declared = preview.tools.find((t) => t.name === "execute");
if (preview.tools.length !== 1 || !declared) throw Error("Expected execute-only production tool frame");
const tool = {
  type: "function",
  name: declared.name,
  description: declared.description,
  parameters: declared.parameters,
};
const scenarios: Record<string, string> = {
  jobs: "Please list my current jobs. Use the tool and tell me what you find.",
  naturalJobs: "What jobs are running?",
  naturalFile: "What does /probe/sandbox/note.txt say?",
  naturalAudio: "Could you clean up the noise in /probe/sandbox/clip.wav and save a cleaned copy?",
  file: "Please inspect the synthetic file /probe/sandbox/note.txt and tell me its contents. Do it rather than telling me how.",
  audio:
    "Please clean up the audio at /probe/sandbox/clip.wav: remove noise and save a cleaned copy. Delegate the actual cleanup to a worker now; don't just suggest a command.",
  weather:
    "Please find the current weather for San Francisco using the available tools; if you can't verify it, say so.",
  correction:
    "You just said you can't access the filesystem or shell. Please reconsider your available host tools and inspect /probe/sandbox/note.txt now.",
};
const variants: Record<string, { suffix: string; desc?: string }> = {
  baseline: { suffix: "" },
  grounding: { suffix: guidance },
  intent: { suffix: guidance + intention },
  description: { suffix: guidance, desc: description },
};
const plan = requested;
async function trial(spec: string, index: number) {
  const [v, s] = spec.split(":");
  const instructions = root + variants[v].suffix;
  const result = {
    trial: index,
    variant: v,
    scenario: s,
    promptHash: createHash("sha256").update(instructions).digest("hex"),
    tools: ["execute"],
  };
  const items: object[] = [];

  if (s === "correction")
    items.push({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "I cannot access the filesystem or shell in voice mode. Please run a command yourself.",
          },
        ],
      },
    });
  items.push({
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [{ type: "input_text", text: scenarios[s] }] },
  });

  const trialResult = await studyTrial({
    model: config.model,
    key,
    instructions,
    tool: { ...tool, description: variants[v].desc ?? tool.description },
    items,
    deadlineMs: 20000,
    speechLimit: 1400,
    stringArguments: true,
    mockOutput: (code) =>
      s === "jobs" || s === "naturalJobs"
        ? { jobs: [] }
        : s === "file" || s === "correction" || s === "naturalFile"
          ? { output: "synthetic file says: blue lantern", exitCode: 0 }
          : s === "audio" || s === "naturalAudio"
            ? String(code).includes("subagent(")
              ? {
                  id: "probe-worker-1",
                  status: "running",
                  background: true,
                  output: "Synthetic delegation accepted; no actual audio processed",
                }
              : { error: "Probe intercepted direct audio command; no execution or delegation occurred" }
            : { output: "No weather lookup configured in synthetic probe", exitCode: 1 },
  });
  const { responses: _responses, ...output } = trialResult;
  Object.assign(result, output);
  return result;
}
for (let i = 0; i < plan.length; i++)
  console.log(JSON.stringify({ privateOutput: true, ...(await trial(plan[i], i + 1)) }));
