import { expect, test } from "bun:test";
import { type RemotePlacement, remoteChildEnvironment, validatePlacement } from "../../src/remote/placement";

test("root may place any child role without inheriting the owner's role or depth", () => {
  for (const profile of ["fast", "normal", "orchestrator"] as const) {
    const placement: RemotePlacement = { profile, parentDepth: 0, workspace: { kind: "inherit" } };
    expect(() => validatePlacement(placement)).not.toThrow();
    expect(remoteChildEnvironment({ BRUV_SUBAGENT_TYPE: "fast", BRUV_SUBAGENT_DEPTH: "99" }, placement)).toEqual({
      BRUV_SUBAGENT_NATIVE_FAST: "0",
      BRUV_SUBAGENT_TYPE: profile,
      BRUV_SUBAGENT_DEPTH: "1",
    });
  }
});

test("a spawned orchestrator may place workers at depth 2, not another orchestrator", () => {
  for (const profile of ["fast", "normal"] as const) {
    const placement: RemotePlacement = {
      profile,
      parentDepth: 1,
      parentType: "orchestrator",
      workspace: { kind: "inherit" },
    };
    expect(remoteChildEnvironment({ BRUV_SUBAGENT_TYPE: "fast", BRUV_SUBAGENT_DEPTH: "99" }, placement)).toEqual({
      BRUV_SUBAGENT_NATIVE_FAST: "0",
      BRUV_SUBAGENT_TYPE: profile,
      BRUV_SUBAGENT_DEPTH: "2",
    });
  }
  const nestedOrchestrator: RemotePlacement = {
    profile: "orchestrator",
    parentDepth: 1,
    parentType: "orchestrator",
    workspace: { kind: "inherit" },
  };
  expect(() => remoteChildEnvironment({}, nestedOrchestrator)).toThrow("fast/normal");
});

test("a spawned fast, normal or unidentified parent cannot place any child role", () => {
  for (const profile of ["fast", "normal", "orchestrator"] as const) {
    for (const parentType of ["normal", "fast", undefined] as const) {
      expect(() => validatePlacement({ profile, parentDepth: 1, parentType, workspace: { kind: "inherit" } })).toThrow(
        "Delegation needs root/orchestrator at depth <2",
      );
    }
  }
});

test("placement distinguishes exhausted delegation depth from malformed depth", () => {
  for (const profile of ["fast", "normal", "orchestrator"] as const) {
    const placement: RemotePlacement = {
      profile,
      parentDepth: 1,
      parentType: "orchestrator",
      workspace: { kind: "inherit" },
    };
    for (const parentDepth of [2, 3])
      expect(() => validatePlacement({ ...placement, parentDepth })).toThrow(
        "Delegation needs root/orchestrator at depth <2",
      );
    for (const parentDepth of [-1, 0.5, NaN, Infinity])
      expect(() => validatePlacement({ ...placement, parentDepth })).toThrow("Invalid remote task role/depth");
  }
});

test("otherwise valid placement rejects invalid workspace kinds, inherit options and unsafe refs", () => {
  for (const workspace of [
    { kind: "other" },
    { kind: "inherit", branch: "x" },
    { kind: "worktree", baseRef: "--upload" },
    { kind: "worktree", branch: "bad branch" },
  ])
    expect(() => validatePlacement({ profile: "normal", parentDepth: 0, workspace } as any)).toThrow();
});

test("omitted placement starts a normal child and strips owner authority, not ordinary server environment", () => {
  const ownerEnvironment = {
    BRUV_SUBAGENT_TYPE: "orchestrator",
    BRUV_SUBAGENT_DEPTH: "1",
    BRUV_ROOT_RUNTIME_TOKEN: "root-only",
    BRUV_REMOTE_RUNTIME_STATE: "/owner/checkpoint",
    OPENAI_API_KEY: "server-provider",
    HOME: "/server",
  };
  expect(remoteChildEnvironment(ownerEnvironment)).toEqual({
    BRUV_SUBAGENT_NATIVE_FAST: "0",
    BRUV_SUBAGENT_TYPE: "normal",
    BRUV_SUBAGENT_DEPTH: "1",
    OPENAI_API_KEY: "server-provider",
    HOME: "/server",
  });
  expect(ownerEnvironment.BRUV_ROOT_RUNTIME_TOKEN).toBe("root-only");
  expect(ownerEnvironment.BRUV_REMOTE_RUNTIME_STATE).toBe("/owner/checkpoint");
  expect(ownerEnvironment.BRUV_SUBAGENT_TYPE).toBe("orchestrator");
  expect(ownerEnvironment.BRUV_SUBAGENT_DEPTH).toBe("1");
});

test("remote fast inheritance is explicit, not inherited from the owner environment", () => {
  const placement: RemotePlacement = {
    profile: "normal",
    parentDepth: 0,
    workspace: { kind: "inherit" },
    nativeFast: true,
  };
  expect(remoteChildEnvironment({}, placement).BRUV_SUBAGENT_NATIVE_FAST).toBe("1");
  expect(remoteChildEnvironment({ BRUV_SUBAGENT_NATIVE_FAST: "1" }).BRUV_SUBAGENT_NATIVE_FAST).toBe("0");
  expect(
    remoteChildEnvironment({ BRUV_SUBAGENT_NATIVE_FAST: "1" }, { ...placement, nativeFast: false })
      .BRUV_SUBAGENT_NATIVE_FAST,
  ).toBe("0");
  expect(() => validatePlacement({ ...placement, nativeFast: "yes" } as any)).toThrow();
});
