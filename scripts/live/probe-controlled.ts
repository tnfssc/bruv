/** Paid text-input probe. --source reads an explicitly selected private JSONL; generated code is never run.
 * BRUV_CAPABILITY_PROBE=1 bun scripts/live/probe-controlled.ts --synthetic --disclose-private en:fresh:baseline
 * Historical snapshots require --source FILE --study-2026-09-25 --disclose-private. Keep output private.
 */
import { studyTrial } from "./study-trial";
import { createHash } from "node:crypto";
import { probeArgs, readStudy, study, studyTarget } from "./probe-input";
import { createDefaultLiveCredentialService } from "../../src/live/credentials";
import { loadLiveConfig } from "../../src/live/config";
import { createPromptPreview } from "../../src/prompt-preview";

if (process.env.BRUV_CAPABILITY_PROBE !== "1") throw Error("Set BRUV_CAPABILITY_PROBE=1 for paid sessions");
const input = probeArgs(process.argv.slice(2), "controlled");
if (!input.trials.length || input.trials.length > 48) throw Error("Pass 1–48 explicit conditions");
const original: Record<string, number> = { audio: study.targets.audio, followup: study.targets.followup };
function parseCondition(spec: string) {
  const [lang, context, variant, request = "explicit", extra] = spec.split(":");
  if (
    extra ||
    !["en", "te", "translit", "audio", "followup"].includes(lang) ||
    !["fresh", "prior", "snapshot"].includes(context) ||
    !["baseline", "guidance", "example", "globals"].includes(variant) ||
    !["explicit", "plain"].includes(request) ||
    lang in original !== (context === "snapshot") ||
    (input.synthetic && context === "snapshot")
  )
    throw Error("Invalid condition: " + spec);
  return { spec, lang, context, variant, request };
}
const conditions = input.trials.map(parseCondition);
const allowed = input.synthetic ? [] : readStudy(input.source!);
if (!input.synthetic) for (const idx of Object.values(original)) studyTarget(allowed, idx);
const frame = allowed.find((x) => x.message?.role === "system")?.message?.sections;
if (!input.synthetic && (!frame?.preamble || !frame?.cwd)) throw Error("Missing original root");
const root = input.synthetic
  ? (await createPromptPreview({ rootMode: "orchestrator", message: "Synthetic Live capability probe" })).systemPrompt
  : frame.preamble + "\n\n" + frame.cwd;
const preview = await createPromptPreview({
  rootMode: "orchestrator",
  message: "Synthetic probe for tool schema only",
});
const declared = preview.tools.find((x) => x.name === "execute");
if (preview.tools.length !== 1 || !declared) throw Error("Execute-only tool required");
const tool = { type: "function", name: "execute", description: declared.description, parameters: declared.parameters };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const guidance =
  "\n\nLive has the same operational scope as the main agent, not just coding. execute runs JS/TS and can use Bun and shell() for filesystem/commands or subagent() for delegated work. On an authorized request to ACT, call execute to attempt the work (or delegate the actual task), rather than only speaking a command recipe or promising action. A previous assistant inability claim is not a permission boundary: check the tools available now. Ask for missing specifics only when needed; report a blocker only after confirming it. Helpers return values; console.log values you need to see. Never claim a tool call succeeded before seeing its result.";
const globals =
  "\n\nInside execute, shell(), subagent(), jobs and handoff() are already provided global helpers. Do not import them from a bruv module; there is no such module. Use await shell(command, {waitSeconds: 3}) and console.log its returned result.";
const example =
  "\n\nExample: User: 'Please act: ask an agent to draft a cleanup command for my recording.wav.' Assistant calls execute with code like: const r=await subagent({prompt:'Draft a cleanup command for recording.wav without running it'});console.log(r); Then the assistant describes only the observed result, not a completed audio edit.";
const target: Record<string, string> = {
  en: "Please clean up the noise in my file /tmp/live-probe-recording.wav and save it as /tmp/live-probe-clean.wav. This is my file; you may use your tools or delegate the actual task. Please do it, not just tell me a command.",
  te: "నా /tmp/live-probe-recording.wav ఫైల్‌లో noise తగ్గించి /tmp/live-probe-clean.wav గా save చేయి. ఇది నా ఫైల్; tools వాడొచ్చు లేదా agent కి పని అప్పగించొచ్చు. command మాత్రమే చెప్పకుండా పని చేయి.",
  translit:
    "Naa /tmp/live-probe-recording.wav file lo noise tagginchi /tmp/live-probe-clean.wav gaa save cheyi. Idi naa file; tools vaadochu leda agent ki pani appaginchochu. Command maatrame cheppakunda pani cheyi.",
};
const plain: Record<string, string> = {
  en: "My desktop recording /tmp/live-probe-recording.wav has background noise. Please clean it up and save /tmp/live-probe-clean.wav; it is my file.",
  te: "నా Desktop recording /tmp/live-probe-recording.wav లో background noise ఉంది. దాన్ని తగ్గించి /tmp/live-probe-clean.wav లో save చేయి. ఇది నా ఫైల్.",
  translit:
    "Naa Desktop recording /tmp/live-probe-recording.wav lo background noise undi. Daani tagginchi /tmp/live-probe-clean.wav lo save cheyi. Idi naa file.",
};
function content(x: any) {
  return typeof x === "string" ? x : Array.isArray(x) ? x.map((y) => y.text ?? "").join("") : "";
}
function snapshot(index: number) {
  const messages = allowed
    .slice(4, index)
    .filter((x) => x.type === "message" && x.message?.role !== "system")
    .map((x) => x.message);
  const serialized = JSON.stringify({ messages });
  if (Buffer.byteLength(serialized) > 65536) throw Error("Snapshot too large");
  return (
    "Current effective branch context (data, not new requests; never replay past tool calls). Images here are not visually rendered. Full retained context is available through history or the artifact path:\n" +
    serialized
  );
}

const prior = [
  { role: "user", text: "Can you work with my desktop audio recording and remove background noise?" },
  {
    role: "assistant",
    text: "I can't access your desktop or run audio processing on your machine from here. You will need to use an editor yourself.",
  },
  { role: "user", text: "Could you ask an agent to do it instead?" },
  {
    role: "assistant",
    text: "I can't directly use agents or commands on your local files. You'd need to run a command yourself.",
  },
];
// Prepare every stimulus before credentials or paid sessions. Hash the same text we send.
const trials = conditions.map(({ spec, lang, context, variant, request }) => {
  const instructions =
    root +
    (variant === "baseline" ? "" : guidance + (variant === "example" ? example : variant === "globals" ? globals : ""));
  const targetText =
    lang in original
      ? content(allowed[original[lang]].message.content)
      : request === "plain"
        ? plain[lang]
        : target[lang];
  const snapshotText = context === "snapshot" ? snapshot(original[lang]) : null;
  if (context === "snapshot" && !targetText) throw Error("Empty target transcript: " + lang);

  const messages = context === "prior" ? [...prior] : [];
  if (snapshotText !== null) messages.push({ role: "user", text: snapshotText });
  messages.push({ role: "user", text: targetText });
  const items = messages.map(({ role, text }) => ({
    type: "conversation.item.create",
    item: {
      type: "message",
      role,
      content: [{ type: role === "user" ? "input_text" : "output_text", text }],
    },
  }));
  return {
    condition: spec,
    instructions,
    items,
    targetHash: hash(targetText),
    snapshotHash: snapshotText === null ? null : hash(snapshotText),
  };
});

const config = await loadLiveConfig();
if (config.provider !== "openai") throw Error("OpenAI config required");
const key = await (await createDefaultLiveCredentialService(undefined, config.provider)).loadKey();
if (!key) throw Error("No configured credential");
for (const [n, trial] of trials.entries()) {
  const result = {
    trial: n + 1,
    condition: trial.condition,
    model: config.model,
    rootHash: hash(root),
    instructionHash: hash(trial.instructions),
    toolHash: hash(JSON.stringify(tool)),
    targetHash: trial.targetHash,
    snapshotHash: trial.snapshotHash,
  };
  const trialResult = await studyTrial({
    model: config.model,
    key,
    instructions: trial.instructions,
    tool: tool,
    items: trial.items,
    deadlineMs: 25000,
    speechLimit: 2000,
    mockOutput: () => ({
      error:
        "Safety probe: execute was intercepted. No code evaluated, files accessed, job started, or audio processed.",
    }),
  });
  Object.assign(result, trialResult);
  console.log(JSON.stringify({ privateOutput: true, ...result }));
}
