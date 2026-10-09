import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/mini";
import { loadProfiles, profilesPath, THINKING_LEVELS } from "../tasks/subagent-profiles";
import type { PermissionRequest } from "./permissions";

const Target = z.strictObject({
  providerInstanceId: z.string().check(z.minLength(1)),
  model: z.string().check(z.minLength(1)),
  options: z.array(z.strictObject({ id: z.string(), value: z.union([z.string(), z.boolean()]) })),
});
const Worker = z.strictObject({
  type: z.literal("normal"),
  target: Target,
  thinking: z.enum(THINKING_LEVELS),
  runtimeMode: z.enum(["approval-required", "auto-accept-edits", "auto", "full-access"]),
  interactionMode: z.enum(["default", "plan"]),
});
const Policy = z.union([
  z.strictObject({ role: z.literal("orchestrator"), depth: z.literal(0), worker: Worker }),
  z.strictObject({ role: z.literal("normal"), depth: z.union([z.literal(1), z.literal(2)]) }),
]);
export type AppWorkerPolicy = z.infer<typeof Policy>;

/** Operator-owned instance policy, not MCP annotations or model-supplied role.
 * Profiles come from the ordinary CLI source; connector state holds only app routing.
 */
export async function loadAppWorkerPolicy(agentDir: string, path = profilesPath()) {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(agentDir, "native-app-worker.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const policy = z.parse(Policy, value);
  if (policy.role === "orchestrator") {
    const normal = await loadNormalAppWorkerProfile(path);
    if (
      !normal.model ||
      !normal.thinking ||
      normal.model !== policy.worker.target.model ||
      normal.thinking !== policy.worker.thinking
    )
      throw new Error("App delegation requires the explicit normal model/thinking from CLI subagents.json");
    // Claude-protocol providers compile this option to --effort. Pin it rather
    // than accidentally inheriting parent reasoning (or merely documenting it).
    if (
      policy.worker.thinking === "off" ||
      !["low", "medium", "high", "xhigh", "max"].includes(policy.worker.thinking) ||
      policy.worker.target.options.length !== 1 ||
      policy.worker.target.options[0]?.id !== "effort" ||
      policy.worker.target.options[0]?.value !== policy.worker.thinking
    )
      throw new Error("App normal worker requires an exact effort option matching CLI thinking");
  }
  return policy;
}

export async function loadNormalAppWorkerProfile(path = profilesPath()) {
  const normal = (await loadProfiles(path)).normal;
  if (!normal.model || !normal.thinking)
    throw new Error("Native normal worker requires an explicit CLI subagents.json model/thinking");
  return { model: normal.model, thinking: normal.thinking };
}

export function bindNormalAppWorker(
  profile: { model: string; thinking: string },
  args: { model?: string; effort?: string; thinking?: string },
) {
  if (args.model !== undefined && args.model !== profile.model)
    throw new Error("Native normal worker model must match CLI subagents.json");
  const explicitThinking =
    args.thinking && !["adaptive", "enabled"].includes(args.thinking) ? args.thinking : undefined;
  if ((args.effort && args.effort !== profile.thinking) || (explicitThinking && explicitThinking !== profile.thinking))
    throw new Error("Native normal worker thinking must match CLI subagents.json");
  return profile;
}

const launches = new Set(["delegate_task", "create_threads", "t3_thread_launch"]);
export function prepareAppWorkerCall(policy: AppWorkerPolicy | undefined, call: PermissionRequest): PermissionRequest {
  if (call.owner !== "app_owned") return call;
  const tool = call.toolName.split("__").at(-1)!;
  if (!launches.has(tool)) return call;
  if (policy?.role !== "orchestrator" || policy.depth !== 0)
    throw new Error("App delegation requires an explicit root orchestrator; normal workers cannot delegate");
  if (tool !== "delegate_task")
    throw new Error("App delegation uses delegate_task, not top-level thread launches");
  if (call.input.type === "orchestrator" || call.input.profile === "orchestrator")
    throw new Error("Native app delegation only permits normal workers");
  return {
    ...call,
    input: {
      ...call.input,
      target: structuredClone(policy.worker.target),
      runtimeMode: policy.worker.runtimeMode,
      interactionMode: policy.worker.interactionMode,
    },
  };
}

export function assertAppWorkerCall(policy: AppWorkerPolicy | undefined, call: PermissionRequest) {
  const admitted = prepareAppWorkerCall(policy, call);
  if (
    call.owner === "app_owned" &&
    call.toolName.endsWith("__delegate_task") &&
    (JSON.stringify(call.input.target) !== JSON.stringify(admitted.input.target) ||
      call.input.runtimeMode !== admitted.input.runtimeMode ||
      call.input.interactionMode !== admitted.input.interactionMode)
  )
    throw new Error("Human-updated app delegation must retain the configured normal worker profile");
}
