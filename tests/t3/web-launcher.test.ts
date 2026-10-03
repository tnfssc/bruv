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
  expect(guide).toContain("Update T3 manually");
});

test("former web flags fail explicitly instead of launching a fallback", async () => {
  expect(await runWeb(["--port", "3773"])).toBe(2);
});
