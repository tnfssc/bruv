# Temporary storage

On 2026-10-02, full code-cleanup validation hit ENOSPC in standalone web extraction. /tmp was a 16 GB tmpfs, 98% used. Host had about 30 GiB RAM and 19 GiB of swap already used. /home had about 115 GB free. The system cleanup timer was present; /tmp age was 10 days, /var/tmp 30 days. A larger memory-backed limit would not fix retained files.

User asked to clean /tmp. Largest cache was /tmp/.pnpm-store (4.9 GB). Several old temporary research checkouts retained dependencies. Checked current-user process cwd, command paths, open descriptors and mappings for candidate use. Removed only the inactive pnpm cache and node_modules under t3-web-effect-fefa08cc, t3-numeric-clean, die-voice-ipc-upstream and die-t3-projection-check. Kept source checkouts, evidence, active files, sockets and unrelated temporary data. /tmp went from 98% used / 454 MB free to 59% used / 6.4 GB free. No mount-size or system cleanup-policy changes. Exact record: artifacts/code-reduction-implementation/tmp-cleanup.json.

For large build/extraction acceptance, use an explicitly owned disk-backed TMPDIR under ~/.bruv, and keep normal per-run cleanup. Do not bulk-delete /tmp or treat a source checkout as disposable cache. Keep actual worktrees under the durable worktree root. Current package builds already use the home pnpm store; do not put long-lived package stores in /tmp. Age-based cleanup is not a size budget.

The identical combined Linux gate passed after moving its temp root to /home/tnfssc/.bruv/code-reduction-tmp-g4HOOc; no test was weakened. Values 5 and 6 already cover bounded resources and preserving user work, so no additional value was added.
