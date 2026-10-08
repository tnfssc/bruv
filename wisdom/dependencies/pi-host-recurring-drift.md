# Recurring Pi host drift

## Work

Parent: /home/tnfssc/.t3/worktrees/bruv/t3-43386b05, branch t3/fix-recurring-pi-host-drift.
Implementation worker: /home/tnfssc/.bruv/worktrees/t3-43386b05-5442693331ce-task_75cb7cfa, branch fix/pi-host-clean-source-recovery.
Read [the first hardlink fix](pi-host-hardlink-isolation.md).

## Why it came back

The old writer polluted Bun's shared installed-package cache. The first fix stopped new write-through. It did not recover the old bytes. Fresh worktree setup still uses that cache. Local branch changes can also leave a private file adapted for a different revision. Neither case means the Pi version changed.

Both this fresh worktree and the reported t3-98a10da6 checkout fail on agent-session.js. Both share the same inodes for all nine host files. agent-session.js has SHA-256 ef78c937779832d87a5a28bbd339e4c73e210d0b5da7ff570723f1d4313be876, not an accepted original or current adapted hash. See [before.json](evidence/pi-host-recovery/before.json). Shared link counts are a point-in-time observation, not proof of who last wrote them.

A new locked install with a fresh owned cache yields all nine accepted source hashes. Preparing it succeeds. Comparing agent-session.js shows the stale file still calls getBranch() in the compaction token estimate. This branch requires getModelContextBranch(). No hashes need relaxing.

## Fix

Keep preparePiHost strict. The asset entrypoint now recovers same-version source drift from a fresh frozen install with an owned cache. Validate the clean source before touching the local installation. Replace only our nine host files using adjacent copies and renames. Never alter the global cache or another checkout. Normal prepared runs stay offline and do not rewrite files. An unsupported Pi version still needs review.

The reported checkout has only been read. Parent ran the real command on its own inherited broken installation. Worker supplied recovery code and hermetic checks.

## Read-only second check

A separate investigator matched agent-session.js to Bun's patched cache entry at /home/tnfssc/.bun/install/cache/@earendil-works/pi-coding-agent@1.0.3@@@1_patch_hash=f67f900e9b31d144. Cache, local checkout, and reported checkout shared inode 59689892. Dropping just the latest compaction-token branch adaptation from the expected output yields the exact observed stale hash. The current definitions also match pristine cached package bytes with the tracked Bun patch applied in memory.

One future simplification is moving all host adaptations into the tracked Bun patch so patch identity covers every change. That alone does not recover today's polluted installations. This task keeps the working adaptation owner and adds verified local recovery, rather than making the user perform another manual cache repair. No historic hash allowlist. No global cache deletion.

## Final proof and boundaries

Implementation details: [drift recovery](pi-host-drift-recovery.md). Recovery rejects borrowed dependency directories that resolve outside the project, before either the normal writer or recovery can run. Both original and stale external-link fixtures stay untouched.

The exact command that failed now exits 0 on the parent checkout and emits the recovery notice. All nine resulting files have the current adapted hashes. Rerunning preparation keeps bytes, inodes, and mtimes stable. The global patched cache keeps its original bytes, inodes, and mtimes. See [real-command.json](evidence/pi-host-recovery/real-command.json). Link counts can change as other work unlinks the same shared files.

The user's reported checkout changed independently during proof: task t3-98a10da6 upgraded to Pi 1.1.0 at 409086c9. This task never wrote there. Its changing state cannot be claimed as an unchanged-sibling integration check. Our hermetic cache/local/sibling hardlink fixture supplies that isolation proof. The upgrade thread was told to combine the recovery code with its own version/hashes and update the pinned fixture for 1.1.0.

The first host test run had two failures because no compiled CLI existed yet. Building the normal CLI and connector succeeds; the next complete focused host/assets run passes. Full Linux/macOS CI and paid provider access were not run.

Values: expanded Finish what user needs with the repeated lesson that preventing new damage does not recover inherited bad state. Existing safety and exact-proof values still apply; no new value was needed.

Final focused gate: 30 tests pass, 1366 assertions across recovery, Pi host semantics, and asset preparation. Paired build, full TypeScript check, repository-wide format check (880 files), and git diff --check pass. See [final-checks.txt](evidence/pi-host-recovery/final-checks.txt). Commits remain local until the user or upgrade thread integrates this branch.
