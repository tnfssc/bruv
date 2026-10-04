import { expect, test } from "bun:test";
import { externalT3Guide, runWeb } from "../../src/t3/web/launcher";

test("external setup uses absolute paired paths and aligned isolated SDK state", () => {
  const guide = externalT3Guide("/opt/bruv/bin/bruv", "/home/alice");
  expect(guide).toContain("Binary path: /opt/bruv/bin/bruv-claude-compat");
  expect(guide).toContain("Start T3 normally: no custom command arguments or parent startup environment");
  expect(guide).not.toContain("t3 --");
  expect(guide).not.toMatch(/CLAUDE_CONFIG_DIR=.*t3/);
  expect(guide).toContain("Leave launch arguments empty");
  expect(guide).toContain("History home (homePath / CLAUDE_CONFIG_DIR path): /home/alice/.bruv/claude-compat-sdk");
  expect(guide).toContain("BRUV_CLAUDE_COMPAT_HOME=/home/alice/.bruv/agent");
  expect(guide).toContain("BRUV_CLAUDE_COMPAT_BRUV_PATH=/opt/bruv/bin/bruv");
  expect(guide).toContain("upstream provider-scoped SDK history fix");
  expect(guide).toContain("2644");
  expect(guide).toContain("does not include it");
  expect(guide).toContain("before Bruv starts");
  expect(guide).toContain("cannot catch");
  expect(guide).toContain("2.1.280 Bruv compatibility profile");
  expect(guide).toContain("Optional environment overrides");
  expect(guide).toContain("updater must not overwrite");
  expect(guide).not.toContain("needs its own Bruv auth/settings setup");
  expect(guide).toContain("No sonnet/opus aliases");
  expect(guide).toContain("NOT Claude Code");
  expect(guide).toContain("https://github.com/pingdotgg/t3code/releases");
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
