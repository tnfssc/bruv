import { expect, test } from "bun:test";
import { validateRemoteRequestFields } from "../src/remote/entry";
test("compiled remote control accepts placement and workspace only on their owning operations", () => {
  const owner = { ownerId: "owner", epoch: "epoch", taskId: "task" };
  const placement = { profile: "orchestrator", parentDepth: 0, workspace: { kind: "worktree" } };
  expect(() =>
    validateRemoteRequestFields({ op: "launch", ...owner, repoPath: "/repo", prompt: "work", placement } as any),
  ).not.toThrow();
  expect(() =>
    validateRemoteRequestFields({
      op: "repository-upload",
      ...owner,
      snapshot: "s",
      sha256: "h",
      total: 1,
      offset: 0,
      data: "YQ==",
      workspace: placement.workspace,
    } as any),
  ).not.toThrow();
  for (const request of [
    { op: "launch", ...owner, host: "arbitrary" },
    { op: "hello", placement },
    { op: "sync", ...owner, workspace: placement.workspace },
    { op: "launch", ...owner, approvedUntracked: ["secret"] },
  ])
    expect(() => validateRemoteRequestFields(request as any)).toThrow("Unsupported");
});
