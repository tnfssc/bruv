# PR #15598 review verification

## Findings

**Macroscope 4177128445: false positive.** Fresh default bundle at exact PR head c1310b2429625e704ef20a175e8b2847f58589ba places the adapter in **dist/binCli-DZ5IwGw5.mjs:141338**, not a nested adapter directory. Its source map's adapter content equals the tracked PR source. The ./claude-history-worker.mjs URL resolves to the existing sibling in dist. See before/emitted-worker.json and emitted-worker.mjs. No worker-path change was made.

The current production npm builder packages a **SEA executable** plus native sidecars, not a nested adapter JS tree (scripts/build-npm-platform-packages.ts:319–364). The adapter's SEA branch (ClaudeAdapterV2.ts:763–765) invokes its own executable with __claude-history. Real installed npm fork traces confirm that branch and its JSON result.

**CodeRabbit 4177149395: valid worker-lifetime gap.** A stalled child could retain the fork indefinitely. Added one production line: Effect.timeout("30 seconds") outside the scoped worker operation, so interruption closes the child scope. The new regression substitutes a real stalled Node child through the spawner, advances the test clock, and verifies the mapped fork error and actual child termination.

## Minimal source commit for parent review

**aeee9df0337bcfa35230e8cd69816815a54e648f**, branch fix/pr-15598-history-worker-deadline, in /home/tnfssc/.bruv/upstream-preparation/t3-pr-15598-npm-review. Parent source/branch was not changed. Two files, one production line + 51 test/import lines; patch is deadline-fix.patch. Parent can fetch/cherry-pick this commit after reviewing; nothing was pushed or posted.

## Exact tests

- Original c1310b242: native environment regression passed; complete adapter file **130 passed** (before/history-regressions.log). That command also named an absent old claudeHistoryClient test; runner reports only **one** executed file, not two.
- New stalled-child test **fails before** the deadline: after advancing 30 virtual seconds, the request remains pending and the test's separate 2-second live-clock watchdog fails (stall-before.log). This is a real subprocess, not an asserted hypothetical SDK stall.
- After deadline: stalled-child test passes (stall-after.log), complete adapter file **131 passed** (deadline-regressions.log). Server tsc passes, targeted fmt passes, lint exits 0 with only an unchanged unused layer warning at the file's end. Initial checks used Node 25.9.0. All four checks were repeated successfully on supported **Node 24.21.0**, saved under after/.
- Freshly built **and npm-installed** launcher + Linux-x64 platform tarballs from c1310b242 and aeee9df03 both pass the original strict **history-only** UI assertions. The before/after proof directories were generated screenshots and per-run JSON/text receipts and have been retired; the retained conclusion is limited to the listed history-only scenarios. fullAcceptancePassed=false was intentional: other scenarios were not run.

## Actual npm packaging, not a relocated URL probe

Built default .mjs and SEA outputs in an isolated tracked-source clone. Used the exact-head scripts build-cli-archive.ts and build-npm-platform-packages.ts, then local npm install of both generated tarballs (only Linux x64, --allow-missing). Trial enters the actual installed **t3/bin/t3.js npm launcher**, which starts the installed platform executable. Supervisor wrapper only traces/supervises this owned process group. Traces recorded real fork arguments, worker stdout JSON, and exit 0; process cleanup was checked. Those per-run receipts are retired.

Server receives **args=[] and only HOME/PATH**; all provider binary, home and environment settings are configured through the Providers UI. No credentials, tap, synthetic connector events or version spoofing. Identity-only harness diff is npm-harness-identity.diff; no behavior assertions were weakened. Parent-built Bruv pair hashes are pinned. Build host: private Node 26.8.2; UI/launcher host: Node 24.21.0. t3 reports its actual version 0.0.45.

**Scope:** server code and npm packaging scripts were rebuilt at each named head; existing parent prebuilt client/resource-monitor assets were physically copied unchanged. Native runtime externals were freshly staged by the repo archive builder. Not an official release, global install, desktop trial, cross-platform proof, server-restart proof, all-scenarios acceptance or full CI claim. No shared dist assets were symlinked. npm-generated local .bin links point inside each private install. Root dependency files were reused via hard links; source outputs/runtime assets are private copies.

Source-runtime worker URL ascends two directories from the actual .ts adapter to src/claude-history-worker.ts, exercised by the environment regression. Default .mjs (including desktop's dist/bin.mjs layout) is flat and retains the sibling URL. SEA/npm/WSL archive entry uses the hidden command, exercised by installed Linux npm trials. Desktop itself was not run.

## Review status / remaining prose

All inline comments, reviews, issue comments and checks captured. Two actionable code findings above; public PR remained on c1310b242. CodeRabbit also warns about missing PR-template sections and boilerplate docstring coverage. PR_BODY_PROPOSED.md supplies Change / Scope and approval / Verification sections; no maintainer approval is invented. No docstring boilerplate added to inline Effect callbacks: existing repo style describes usage/constraints rather than narrating every function. Parent owns description update and replies (REVIEW_REPLIES.md).

## Reproduction locations

- Before packages, installed stage, immutable .mjs copy, tracing and UI harness: /var/tmp/t3-pr-15598-npm
- After packages, installed stage and UI harness: /var/tmp/t3-pr-15598-npm-after
- Original strict harness: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_1cbcc09f-5442693331ce-task_8884d842/experiments/t3/ui-only-history-minimal (9a975292)
- Commands in REPRODUCE.md. Logs, SHA-256 artifact/tree inventories and UI evidence committed here; binaries/tarballs remain private, not in Git.


Generated proof receipts were retired after preserving these conclusions and the reproducible harness/source notes. Recover the original receipts from Git at `baf2fcd5c9976ee19a8cbc0ae8839875d714cc38`.
