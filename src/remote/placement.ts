import { canDelegate, SUBAGENT_TYPES, type SubagentType } from "../tasks/subagent-profiles";
export type RemoteWorkspace = { kind: "inherit" } | { kind: "worktree"; baseRef?: string; branch?: string };
export type RemotePlacement = {
  profile: SubagentType;
  parentDepth: number;
  parentType?: SubagentType;
  workspace: RemoteWorkspace;
};
/** Same delegation boundary at both ends. Wire input is untrusted, even after parent preflight. */
export function validatePlacement(placement: RemotePlacement): void {
  if (
    !placement ||
    !SUBAGENT_TYPES.includes(placement.profile) ||
    !Number.isSafeInteger(placement.parentDepth) ||
    placement.parentDepth < 0 ||
    (placement.parentType !== undefined && !SUBAGENT_TYPES.includes(placement.parentType))
  )
    throw Error("Invalid remote task role/depth");
  if (!canDelegate(placement.parentDepth, placement.parentType))
    throw Error("Only root or orchestrator agents below depth 2 can delegate");
  validateWorkspace(placement.workspace);
}
export function validateWorkspace(workspace: RemoteWorkspace): void {
  if (!workspace || !["inherit", "worktree"].includes(workspace.kind)) throw Error("Invalid remote workspace");
  if (workspace.kind === "inherit") {
    if ("baseRef" in workspace || "branch" in workspace) throw Error("inherit cannot request a baseRef or branch");
  } else {
    for (const value of [workspace.baseRef, workspace.branch])
      if (
        value !== undefined &&
        (typeof value !== "string" || !value.trim() || value.startsWith("-") || /[\x00-\x20]/.test(value))
      )
        throw Error("Invalid remote workspace ref");
  }
}
/** Do not inherit an owner's role/depth by accident (including legacy remote.launch). */
export function remoteChildEnvironment(env: NodeJS.ProcessEnv, placement?: RemotePlacement): NodeJS.ProcessEnv {
  if (placement) validatePlacement(placement);
  return {
    ...env,
    DIE_SUBAGENT_TYPE: placement?.profile ?? "normal",
    DIE_SUBAGENT_DEPTH: String(placement ? placement.parentDepth + 1 : 1),
  };
}
