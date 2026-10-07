import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import product from "../../package.json";

// Protocol compatibility identity, not an Anthropic product/auth claim.
export const COMPAT_PROTOCOL_VERSION = "2.1.280";
// CLI display identity must contain no dotted semver: external T3 must not
// mistake this connector for a Claude Code update candidate. SDK init keeps
// COMPAT_PROTOCOL_VERSION; Bruv packaging uses BRUV_CONNECTOR_VERSION.
export const CONNECTOR_DISPLAY_IDENTITY = "Bruv connector";
export const BRUV_CONNECTOR_VERSION = "bruv-claude-compat " + product.version;

/** Only expand the current user's home prefix; do not interpret shell syntax. */
export function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

export function connectorLaunchDefaults(
  env: NodeJS.ProcessEnv,
  home = homedir(),
  executable = process.execPath,
  cwd = process.cwd(),
): { agentDir: string; executablePath: string } {
  // A packaged subcommand runs inside normal bruv itself. The standalone native
  // connector uses its normal sibling; never send child CLI flags to the wrapper.
  const windows = executable.endsWith(".exe");
  const normal =
    basename(executable) === (windows ? "bruv.exe" : "bruv")
      ? executable
      : join(dirname(executable), windows ? "bruv.exe" : "bruv");
  return {
    agentDir: resolve(cwd, expandHome(env.BRUV_CLAUDE_COMPAT_HOME ?? join(home, ".bruv", "agent"), home)),
    executablePath: resolve(cwd, expandHome(env.BRUV_CLAUDE_COMPAT_BRUV_PATH ?? normal, home)),
  };
}
