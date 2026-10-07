import { expect, spyOn, test } from "bun:test";
import { externalT3Guide, runWeb } from "../../src/t3/web/launcher";

test("terminal guide follows install-to-chat steps with absolute isolated paths", () => {
  const guide = externalT3Guide("/opt/bruv/bin/bruv", "/home/alice");
  const headings = guide.match(/^\d\. .+$/gm);
  expect(headings).toEqual([
    "1. Install the matched Bruv pair",
    "2. Configure your provider in ordinary Bruv",
    "3. Install official T3 and launch normally",
    "4. Add a separate provider instance named Bruv",
    "5. Add the exact custom model and set auxiliary models",
    "6. Select Bruv and smoke-test a chat",
  ]);
  expect(guide).toContain("curl -fsSL 'https://raw.githubusercontent.com/tnfssc/bruv/develop/scripts/install.sh' | sh");
  expect(guide).toContain("bruv-claude-compat --bruv-version");
  expect(guide).toContain("Use /login, then /model");
  expect(guide).toContain("share auth, models, settings and resources:\n\n     /home/alice/.bruv/agent");
  expect(guide).toContain("native transcripts, not credentials");
  expect(guide).toContain("Binary path:\n       /opt/bruv/bin/bruv-claude-compat");
  expect(guide).toContain(
    "SDK history home (homePath / CLAUDE_CONFIG_DIR path):\n       /home/alice/.bruv/claude-compat-sdk",
  );
  expect(guide).toContain("Launch arguments: leave empty");
  expect(guide).toContain("No environment overrides needed");
  expect(guide).toContain("NOT Claude Code or an Anthropic login");
  expect(guide).toContain("Leave your existing Claude instance untouched");
  expect(guide).toContain("exact provider/model-id");
  expect(guide).toContain("ID for auxiliary title, branch and text generation");
  expect(guide).toContain("No sonnet/opus aliases");
  expect(guide).toContain("Bruv needs an explicit\n   default");
  expect(guide).toContain("Bruv instance AND your exact custom model");
  expect(guide).toContain("does not verify provider access");
  expect(guide).toContain("https://github.com/pingdotgg/t3code/releases");
  expect(guide).toContain("https://github.com/tnfssc/bruv/blob/develop/wisdom/docs/t3-code/README.md");
  expect(guide).toContain("https://github.com/tnfssc/bruv/blob/develop/wisdom/claude-compat/external-t3-setup.md");
  expect(guide).not.toMatch(/\x1b|t3 --|npx t3@latest|CLAUDE_CONFIG_DIR=.*t3/);
});

test("guide retains history limitations and safe paired updates without parent workaround", () => {
  const guide = externalT3Guide();
  expect(guide).toContain("No custom launch arguments or parent/server/global CLAUDE_CONFIG_DIR");
  expect(guide).toContain("Do not change HOME or ordinary Claude state");
  expect(guide).toContain("never use ~/.claude or the auth home");
  expect(guide).toContain("Connector --version is only Bruv connector");
  expect(guide).toContain("SDK init stays 2.1.280");
  expect(guide).toContain("CLI version as unknown");
  expect(guide).toContain("too-old model");
  expect(guide).toContain("custom Bruv provider/id models stay available");
  expect(guide).toContain("2644 lacks the provider-scoped SDK history fix");
  expect(guide).toContain("before Bruv starts");
  expect(guide).toContain("no fixed release");
  expect(guide).toContain("Do not work around it with the parent environment");
  expect(guide).toContain("explicitly Decline any stale approval card; do not approve it");
  expect(guide).toContain("Never use T3's Claude login or install for Bruv");
  expect(guide).toContain("the connector's paired Bruv updater (not Claude)");
  expect(guide).toContain("Label-only CLI identity avoids latest-Claude update candidates");
  expect(guide).toContain("Restart T3 after updating");
  expect(guide).toContain("Stop active Bruv/T3 sessions");
  expect(guide).toContain("bruv update --check    (read-only check)");
  expect(guide).toContain("bruv update            (CLI + connector together)");
  expect(guide).toContain("manual paired reinstall");
  expect(guide).toContain("Update T3 separately");
});

test("web only prints setup for accepted flags and explicitly rejects former server flags", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const args of [[], ["--help"], ["-h"], ["--setup"]]) {
      log.mockClear();
      expect(await runWeb(args)).toBe(0);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(externalT3Guide());
    }
    expect(error).not.toHaveBeenCalled();
    log.mockClear();
    expect(await runWeb(["--port", "3773"])).toBe(2);
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "bruv web no longer launches a bundled server. Run bruv web for provider Settings setup, then start official T3 normally.",
    );
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
});
