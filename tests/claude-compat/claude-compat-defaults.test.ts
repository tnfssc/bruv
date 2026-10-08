import { expect, test } from "bun:test";
import { connectorLaunchDefaults, expandHome } from "../../src/claude-compat/launch";

test("ordinary auth home and normal sibling executable are absolute defaults", () => {
  expect(connectorLaunchDefaults({}, "/home/alice", "/opt/Bruv App/bruv-claude-compat", "/project")).toEqual({
    agentDir: "/home/alice/.bruv/agent",
    executablePath: "/opt/Bruv App/bruv",
  });
  expect(connectorLaunchDefaults({}, "/home/bob", "/opt/Bruv App/bruv", "/project")).toEqual({
    agentDir: "/home/bob/.bruv/agent",
    executablePath: "/opt/Bruv App/bruv",
  });
});
test("explicit paths and home-prefix overrides preserve spaces without shell expansion", () => {
  expect(
    connectorLaunchDefaults(
      { BRUV_CLAUDE_COMPAT_HOME: "~/.bruv/agent space", BRUV_CLAUDE_COMPAT_BRUV_PATH: "~/bin/bruv space" },
      "/home/alice",
      "/opt/bruv",
      "/project",
    ),
  ).toEqual({
    agentDir: "/home/alice/.bruv/agent space",
    executablePath: "/home/alice/bin/bruv space",
  });
  expect(
    connectorLaunchDefaults(
      { BRUV_CLAUDE_COMPAT_HOME: "/separate auth", BRUV_CLAUDE_COMPAT_BRUV_PATH: "bin/bruv" },
      "/home/alice",
      "/opt/bruv",
      "/project",
    ),
  ).toEqual({
    agentDir: "/separate auth",
    executablePath: "/project/bin/bruv",
  });
  expect(expandHome("~", "/home/alice")).toBe("/home/alice");
  expect(expandHome("$HOME/agent", "/home/alice")).toBe("$HOME/agent");
  expect(expandHome("~other/agent", "/home/alice")).toBe("~other/agent");
});
