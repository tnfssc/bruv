import { expect, test } from "bun:test";
import { createPermissionPolicy, type PermissionRequest } from "../../src/claude-compat/permissions";
const execute: PermissionRequest = {
  toolName: "execute",
  input: { code: "await shell('rm -rf scratch')", label: "Arbitrary TypeScript" },
  toolUseId: "real-call-id",
  effect: "arbitrary-typescript",
  owner: "bruv",
  signal: new AbortController().signal,
};
test("Bash allow rules never grant execute permission; callback receives actual TypeScript", async () => {
  let observed: PermissionRequest | undefined;
  const policy = createPermissionPolicy({
    mode: "default",
    allowedTools: ["Bash", "Bash(*)"],
    canUseTool: async (request) => {
      observed = request;
      return { behavior: "deny", message: "no arbitrary code" };
    },
  });
  expect((await policy(execute)).behavior).toBe("deny");
  expect(observed).toEqual(execute);
});
test("plan rejects arbitrary execute even with explicit allow or human callback", async () => {
  let prompts = 0;
  const policy = createPermissionPolicy({
    mode: "plan",
    allowedTools: ["execute"],
    canUseTool: async () => {
      prompts++;
      return { behavior: "allow" };
    },
  });
  expect(await policy(execute)).toEqual({
    behavior: "deny",
    message: "Plan mode needs enforced read-only tools. TypeScript and MCP can write.",
  });
  expect(prompts).toBe(0);
  expect((await policy({ ...execute, toolName: "read", effect: "read-only" })).behavior).toBe("allow");
});
test("dontAsk rejects unapproved calls but allows explicitly approved tools", async () => {
  const unapproved = createPermissionPolicy({ mode: "dontAsk" });
  const approved = createPermissionPolicy({ mode: "dontAsk", allowedTools: ["execute"] });

  expect(await unapproved(execute)).toEqual({ behavior: "deny", message: "Tool needs explicit permission" });
  expect((await approved(execute)).behavior).toBe("allow");
});
test("disallowed tools take precedence over explicitly allowed tools", async () => {
  const policy = createPermissionPolicy({
    mode: "default",
    allowedTools: ["execute"],
    disallowedTools: ["execute"],
  });

  expect((await policy(execute)).behavior).toBe("deny");
});
test("dangerous permission mode requires opt-in before a policy can be created", () => {
  expect(() => createPermissionPolicy({ mode: "bypassPermissions" })).toThrow("opt-in");
});
test("permission cancellation never accepts a stale allow", async () => {
  const abort = new AbortController();
  const policy = createPermissionPolicy({
    mode: "default",
    canUseTool: async () => {
      abort.abort();
      return { behavior: "allow" };
    },
  });
  await expect(policy({ ...execute, signal: abort.signal })).rejects.toThrow();
});
