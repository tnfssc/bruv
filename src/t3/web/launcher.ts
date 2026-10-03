import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function externalT3Guide(binary = process.execPath, home = homedir()): string {
  const connector = resolve(dirname(binary), "bruv-claude-compat");
  const normal = resolve(dirname(binary), "bruv");
  const agent = join(home, ".bruv", "agent");
  const sdk = join(home, ".bruv", "claude-compat-sdk");
  const web = join(home, ".bruv", "web");
  return [
    "Bruv web uses external, unmodified T3 Code. Nothing is downloaded or configured by this command.",
    "Install T3 manually using https://github.com/pingdotgg/t3code#installation (official CLI: t3; one-off: npx t3@latest).",
    "Reviewed upstream: fed41fa88bb27cb4325cb208d571393850bc63c2 (v0.0.46-nightly.20261003.2623). Newer versions need native acceptance again.",
    "Keep the ordinary bruv CLI for authentication, profiles, resources, and delegated children.",
    "Launch the T3 SERVER with the same isolated SDK home used by its Claude provider instance:",
    "  CLAUDE_CONFIG_DIR=" + JSON.stringify(sdk) + " t3 --host 127.0.0.1 --base-dir " + JSON.stringify(web),
    "Check t3 --help on your installed version. --no-browser disables automatic browser opening.",
    "In Settings > Providers add a separate Claude instance named Bruv (do not edit your real Claude instance):",
    "  Binary path: " + connector,
    "  CLAUDE_CONFIG_DIR path: " + sdk,
    "  Environment variables (not launch arguments):",
    "    BRUV_CLAUDE_COMPAT_HOME=" + agent,
    "    BRUV_CLAUDE_COMPAT_BRUV_PATH=" + normal,
    "This explicitly reuses existing Bruv auth/models/settings/resources at " +
      agent +
      "; no secrets are copied into T3.",
    "Subagent profiles remain shared at " +
      join(home, ".bruv", "subagents.json") +
      "; a separate auth home does not isolate all Bruv host resources.",
    "Without that HOME override, the connector uses " +
      join(home, ".bruv", "claude-compat") +
      " and needs its own Bruv auth/settings setup.",
    "SDK-native transcripts belong only in " +
      sdk +
      "/projects; parent SDK list/resume/fork requires server-level CLAUDE_CONFIG_DIR, not merely a child env setting.",
    "Do not point this directory at ~/.claude, migrate/delete Claude state, or change HOME.",
    "Add custom models using exact Bruv provider/id from your configured model registry, then select that same ID in chat and auxiliary/title generation.",
    "No sonnet/opus aliases or guessed provider mappings. Verify the selected provider/id in native initialization and real provider usage.",
    "Claude is T3's protocol-slot label, NOT Claude Code, an Anthropic login/subscription, or verified provider access. Health can indicate local readiness only.",
    "Never use T3's Claude install/login/update actions for this connector. Update T3 manually with t3 update; update the paired Bruv binaries manually together.",
    "bruv update updates only the normal CLI. Reinstall the matched pair to update the connector. Stop active sessions before replacing binaries.",
    "Packaging is not parity acceptance. Unsupported controls/settings must fail explicitly; do not release until unchanged-T3 native acceptance passes.",
    "Full setup and isolation options: wisdom/claude-compat/external-t3-setup.md",
    "",
  ].join("\n");
}

/** Setup guidance only: no bundled UI, subprocess, settings seeding or fallback. */
export async function runWeb(args: string[]): Promise<number> {
  if (args.some((arg) => !["--help", "-h", "--setup"].includes(arg))) {
    console.error(
      "bruv web no longer launches a bundled server. Run bruv web for external T3 setup; pass server flags to t3 itself.",
    );
    return 2;
  }
  console.log(externalT3Guide());
  return 0;
}
