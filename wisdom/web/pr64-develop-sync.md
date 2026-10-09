# PR64 develop sync

User asked to resolve conflicts when needed. GitHub reported PR64 CONFLICTING at58427903. Active integration tree: /home/tnfssc/.bruv/worktrees/bruv-web-ghostty-integration, branch bruv/web-ghostty-integration. Fetched develop at a989356d (includes v0.16.24 and the stricter Biome warning gate). Finished worktrees stay unchanged.

There was one textual conflict, in src/live/extension.ts. Upstream converted the redacted startup diagnostic to a template string; the browser branch added microphone/retry guidance. Keep both: the template string for withheld details, the browser-specific guidance when BRUV_LIVE_RELAY_URL is set, and audioLaunchDiagnostic() for native audio. Do not discard the browser path to accept the formatting change.

The merge is resolved locally and typecheck passes. The stricter upstream lint gate finds 96 warnings and 194 infos in the browser branch. These were allowed by the older gate. Do not weaken the new gate. Address warnings on the combined Ghostty tree to avoid fixing code that migration replaces. This merge commit is a local integration checkpoint, not publication or green CI. Ghostty work is still separate and must be integrated after its handoff. No merge into develop, no CLI install. Values unchanged: preserve both intended behaviors and test the combined tree.
