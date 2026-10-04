import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function externalT3Guide(binary = process.execPath, home = homedir()): string {
  const connector = resolve(dirname(binary), "bruv-claude-compat");
  const normal = resolve(dirname(binary), "bruv");
  const agent = join(home, ".bruv", "agent");
  const sdk = join(home, ".bruv", "claude-compat-sdk");
  return [
    "Bruv web uses external, unmodified T3 Code. Nothing is downloaded or configured by this command.",
    "Install official T3 desktop or web separately from https://github.com/pingdotgg/t3code/releases and verify its published checksums. Open desktop normally or run t3.",
    "Full UI-only native history requires the upstream provider-scoped SDK history fix. Confirm its availability in your T3 build; 2644 (737993303d36e10674c54b95e5bd3826682c99c7) does not include it.",
    "Keep the ordinary bruv CLI for authentication, profiles, resources, and delegated children.",
    "Start T3 normally: no custom command arguments or parent startup environment. Configure only the provider instance below.",
    "In Settings > Providers add a separate Claude instance named Bruv (do not edit your real Claude instance):",
    "  Binary path: " + connector,
    "  History home (homePath / CLAUDE_CONFIG_DIR path): " + sdk,
    "  Leave launch arguments empty; T3 owns SDK flags.",
    "  Environment variables (provider instance only, not launch arguments or parent environment):",
    "    BRUV_CLAUDE_COMPAT_HOME=" + agent,
    "    BRUV_CLAUDE_COMPAT_BRUV_PATH=" + normal,
    "This explicitly reuses existing Bruv auth/models/settings/resources at " +
      agent +
      "; no secrets are copied into T3.",
    "Subagent profiles remain shared at " +
      join(home, ".bruv", "subagents.json") +
      "; a separate auth home does not isolate all Bruv host resources.",
    "Without explicit BRUV_CLAUDE_COMPAT_HOME, the connector uses " +
      join(home, ".bruv", "claude-compat") +
      " and needs its own Bruv auth/settings setup.",
    "SDK-native transcripts belong only in " +
      sdk +
      "/projects; corrected T3 scopes its own SDK history calls to this provider home.",
    "Do not point this directory at ~/.claude, migrate/delete Claude state, change HOME, or set a server-level CLAUDE_CONFIG_DIR.",
    "On pre-fix T3, basic chat may work, but native fork can fail upstream before Bruv starts. Bruv cannot catch or guarantee graceful handling of that failure. No silent fallback.",
    "Add custom models using exact Bruv provider/id from your configured model registry, then select that same ID in chat and auxiliary/title generation.",
    "Set an explicit default provider/model in the selected Bruv home too if T3 health omits its model; missing selection fails locally, never picks the first authenticated model.",
    "No sonnet/opus aliases or guessed provider mappings. Verify the selected provider/id in native initialization and real provider usage.",
    "Claude is T3's protocol-slot label, NOT Claude Code, an Anthropic login/subscription, or verified provider access. Health can indicate local readiness only.",
    "Never use T3's Claude install/login/update actions for this connector. Unsupported version/update banners are a separate unresolved T3 compatibility issue, not fixed by the history patch; do not spoof Claude identity or version to suppress them.",
    "bruv update --check is read-only; bruv update updates the sibling CLI and connector together. Split/custom layouts require manual paired reinstall. Stop active Bruv/T3 sessions first, then restart.",
    "T3 updates independently; verify history-fix availability and rerun native acceptance after updates.",
    "Known upstream gap: Stop prevents a pending approval side effect but leaves its stale card visible; explicitly Decline that card before continuing.",
    "Live is off by default: same-host audio requires BRUV_CLAUDE_COMPAT_LOCAL_AUDIO_HOST=<exact connector hostname> plus per-action human consent. It is NOT browser microphone transport; never paste provider keys into T3.",
    "2644 passed bounded deterministic gates with earlier parent-home alignment, not full UI-only history or parity. The upstream Effect queue race remains unfixed; Live/devices/paid providers and full tab disconnect are not covered.",
    "Full setup and isolation options: https://github.com/tnfssc/bruv/blob/develop/wisdom/claude-compat/external-t3-setup.md",
    "",
  ].join("\n");
}

/** Setup guidance only: no bundled UI, subprocess, settings seeding or fallback. */
export async function runWeb(args: string[]): Promise<number> {
  if (args.some((arg) => !["--help", "-h", "--setup"].includes(arg))) {
    console.error(
      "bruv web no longer launches a bundled server. Run bruv web for provider Settings setup, then start official T3 normally.",
    );
    return 2;
  }
  console.log(externalT3Guide());
  return 0;
}
