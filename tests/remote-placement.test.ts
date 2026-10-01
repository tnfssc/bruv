import { expect, test } from "bun:test";
import { validatePlacement, remoteChildEnvironment, type RemotePlacement } from "../src/remote/placement";
test("remote placement validates the same delegation boundary and never inherits owner role", () => {
  for (const profile of ["fast", "normal", "orchestrator"] as const) {
    const root: RemotePlacement = { profile, parentDepth: 0, workspace: { kind: "inherit" } };
    expect(() => validatePlacement(root)).not.toThrow();
    const nested = { ...root, parentDepth: 1, parentType: "orchestrator" as const };
    if (profile === "orchestrator") {
      expect(() => remoteChildEnvironment({}, nested)).toThrow("fast/normal");
    } else {
      expect(remoteChildEnvironment({ DIE_SUBAGENT_TYPE: "fast", DIE_SUBAGENT_DEPTH: "99" }, nested)).toEqual({
        DIE_SUBAGENT_TYPE: profile,
        DIE_SUBAGENT_DEPTH: "2",
      });
    }
    for (const parent of ["normal", "fast", undefined] as const)
      expect(() => validatePlacement({ ...nested, parentType: parent })).toThrow();
    for (const parentDepth of [2, 3, -1, 0.5, NaN, Infinity])
      expect(() => validatePlacement({ ...nested, parentDepth })).toThrow();
  }
  expect(
    remoteChildEnvironment({ DIE_SUBAGENT_TYPE: "orchestrator", DIE_SUBAGENT_DEPTH: "1", HOME: "/server" }),
  ).toEqual({ DIE_SUBAGENT_TYPE: "normal", DIE_SUBAGENT_DEPTH: "1", HOME: "/server" });
  for (const workspace of [
    { kind: "other" },
    { kind: "inherit", branch: "x" },
    { kind: "worktree", baseRef: "--upload" },
    { kind: "worktree", branch: "bad branch" },
  ])
    expect(() => validatePlacement({ profile: "normal", parentDepth: 0, workspace } as any)).toThrow();
});
