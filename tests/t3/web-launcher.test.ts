import { expect, test } from "bun:test";
import { externalT3Guide, runWeb } from "../../src/t3/web/launcher";

test("external setup uses absolute paired paths and aligned isolated SDK state", () => {
  const guide = externalT3Guide("/opt/bruv/bin/bruv", "/home/alice");
  expect(guide).toContain("Binary path: /opt/bruv/bin/bruv-claude-compat");
  expect(guide).toContain('CLAUDE_CONFIG_DIR="/home/alice/.bruv/claude-compat-sdk" t3 --host 127.0.0.1');
  expect(guide).toContain("CLAUDE_CONFIG_DIR path: /home/alice/.bruv/claude-compat-sdk");
  expect(guide).toContain("BRUV_CLAUDE_COMPAT_HOME=/home/alice/.bruv/agent");
  expect(guide).toContain("BRUV_CLAUDE_COMPAT_BRUV_PATH=/opt/bruv/bin/bruv");
  expect(guide).toContain("parent SDK list/resume/fork");
  expect(guide).toContain("No sonnet/opus aliases");
  expect(guide).toContain("NOT Claude Code");
  expect(guide).toContain("https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261004.2644");
  expect(guide).toContain("737993303d36e10674c54b95e5bd3826682c99c7");
  expect(guide).not.toContain("npx t3@latest");
  expect(guide).not.toContain("fed41fa88bb27cb4325cb208d571393850bc63c2");
  expect(guide).toContain("bruv update updates the sibling CLI and connector together");
  expect(guide).not.toContain("only the normal CLI");
  expect(guide).toContain("explicitly Decline");
  expect(guide).toContain("BRUV_CLAUDE_COMPAT_LOCAL_AUDIO_HOST");
  expect(guide).toContain("NOT browser microphone transport");
  expect(guide).toContain("Effect queue race remains unfixed");
  expect(guide).toContain("https://github.com/tnfssc/bruv/blob/develop/wisdom/claude-compat/external-t3-setup.md");
});

test("former web flags fail explicitly instead of launching a fallback", async () => {
  expect(await runWeb(["--port", "3773"])).toBe(2);
});
