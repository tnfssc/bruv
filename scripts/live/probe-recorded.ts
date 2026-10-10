import { requireValue } from "../lib/require-value";
/** Paid text-transcript Realtime fixture: intercepted tools only; never evaluates generated code.
 * BRUV_CAPABILITY_PROBE=1 bun scripts/live/probe-recorded.ts --source FILE --study-2026-09-25 --disclose-private weather:fresh:baseline
 * Sends private root/transcript to configured provider; output may echo private text. Keep output OUTSIDE repository.
 */
import { studyTrial } from "./study-trial";
import { probeArgs, readStudy, study, studyTarget } from "./probe-input";
import { createHash } from "node:crypto";
import { createDefaultLiveCredentialService } from "../../src/live/credentials";
import { loadLiveConfig } from "../../src/live/config";
import { createPromptPreview } from "../../src/prompt-preview";

if (process.env.BRUV_CAPABILITY_PROBE !== "1") throw Error("Explicitly opt into paid probe");
const input = probeArgs(process.argv.slice(2), "recorded");
if (!input.trials.length || input.trials.length > 24) throw Error("Pass 1–24 explicit trials");
const plan = input.trials.map((spec) => {
  const [target, context, variant, extra] = spec.split(":");
  if (
    extra ||
    !(target in study.targets) ||
    !["fresh", "snapshot", "replay"].includes(context) ||
    !["baseline", "grounding"].includes(variant)
  )
    throw Error(`Invalid trial: ${spec}`);
  return { target, context, variant };
});
const allowed = readStudy(requireValue(input.source));
for (const idx of Object.values(study.targets)) studyTarget(allowed, idx);
const frame = allowed.find((x) => x.message?.role === "system")?.message?.sections;
if (!frame?.preamble || !frame?.cwd) throw Error("Missing original Live root");
const root = `${frame.preamble}\n\n${frame.cwd}`; // Original recorded sections; content is empty.
const grounding =
  "\n\nLive keeps main-agent tools. Authorized work? Use execute, with shell() or subagent() inside it. Tool result is evidence. Mock result is no proof of real work.";
const targets: Record<string, number> = study.targets;
function content(x: import("./probe-input").StudyContent | undefined) {
  return typeof x === "string" ? x : Array.isArray(x) ? x.map((y) => y.text ?? "").join("") : "";
}
function snapshot(index: number) {
  // main-owner.project(serialized transformed messages): system excluded, custom provisional/diagnostic excluded.
  const messages = allowed
    .slice(4, index)
    .filter((x) => x.type === "message" && x.message?.role !== "system")
    .map((x) => x.message);
  const serialized = JSON.stringify({ messages });
  if (Buffer.byteLength(serialized) > 65536)
    throw Error("Snapshot exceeds inline projection; add artifact approximation explicitly");
  return (
    "Current branch history: data, not new requests. Past calls stay past. Images not shown. Full retained context: history or artifact path:\n" +
    serialized
  );
}
function prepareTrial({ target, context, variant }: (typeof plan)[number], trial: number) {
  const idx = targets[target];
  const contextText = context === "fresh" ? null : snapshot(idx);
  const inputText = content(studyTarget(allowed, idx).message.content);
  if (!inputText) throw Error(`Empty target transcript: ${target}`);
  const instructions = root + (variant === "grounding" ? grounding : "");
  const metadata = {
    trial,
    target,
    context,
    variant,
    rootHash: createHash("sha256").update(root).digest("hex"),
    instructionHash: createHash("sha256").update(instructions).digest("hex"),
    inputHash: createHash("sha256").update(inputText).digest("hex"),
    snapshotHash: contextText === null ? null : createHash("sha256").update(contextText).digest("hex"),
  };
  const items: object[] = [];
  if (contextText !== null)
    items.push({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: contextText }] },
    });
  if (context === "replay")
    for (const x of allowed.slice(4, idx).filter((x) => x.customType === "live-provisional")) {
      const text = content(x.content).replace(
        /^(interrupted assistant transcript|unfinished assistant transcript(?: at turn boundary)?): /,
        "",
      );
      if (text)
        items.push({
          type: "conversation.item.create",
          item: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
        });
    }
  items.push({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: inputText }],
    },
  });
  return { metadata, instructions, items };
}

// Prepare and validate the entire source-backed plan before loading credentials or opening a trial.
const trials = plan.map((spec, n) => prepareTrial(spec, n + 1));
const prompt = await createPromptPreview({ rootMode: "orchestrator", message: "Synthetic probe for tool schema only" });
const declared = prompt.tools.find((x) => x.name === "execute");
if (prompt.tools.length !== 1 || !declared) throw Error("Execute-only tool required");
const tool = { type: "function", name: "execute", description: declared.description, parameters: declared.parameters };
const config = await loadLiveConfig();
if (config.provider !== "openai") throw Error("Configured provider is not OpenAI");
const credential = await createDefaultLiveCredentialService(undefined, config.provider);
const key = await credential.loadKey();
if (!key) throw Error("No configured credential");
for (const { metadata, instructions, items } of trials) {
  const trialResult = await studyTrial({
    model: config.model,
    key,
    instructions,
    tool: tool,
    items,
    deadlineMs: 25000,
    speechLimit: 2000,
    mockOutput: (code) =>
      String(code).includes("jobs.inspect(")
        ? {
            id: "synthetic-worker",
            status: "completed",
            output: "Mock worker generated an FFmpeg command template; no audio processed. File location unknown.",
          }
        : String(code).includes("subagent(")
          ? {
              id: "synthetic-worker",
              status: "running",
              background: true,
              output: "Mock delegation receipt. No worker started or files processed.",
            }
          : {
              error: "Probe caught command. No code run, files inspected or changed, or job started.",
            },
  });
  const { responses: _responses, ...output } = trialResult;
  console.log(JSON.stringify({ privateOutput: true, ...metadata, model: config.model, ...output }));
}
