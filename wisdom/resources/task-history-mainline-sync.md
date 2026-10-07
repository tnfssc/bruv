# Sync the task-history PR with mainline

User asked to sync PR #48 with main. This repo has no main ref; develop is its mainline. Merged origin/develop at 307eb514 into PR head e4e53cb4. Merge is clean.

New sync checkout: /home/tnfssc/.bruv/worktrees/bruv-task-history-main-sync. Local branch: sync/task-history-mainline. Push its merge commit to the existing fix/task-history-resource-growth PR branch. The earlier completed fix checkout stays unchanged.

Mainline adds the mise worktree setup fix and atomic Pi-host adaptation writes. The latter keeps Bun cache hardlinks unchanged and prevents the cache corruption behind the hosted asset-preparation failure; it does not repair an old contaminated cache. See [hardlink fix](../dependencies/pi-host-hardlink-isolation.md). The merge keeps the resource PR's newer SDK adaptation anchors/hashes and mainline's private-copy/rename writer. No source/result hash was relaxed.

Use a fresh private Bun cache and copy backend for this checkout's validation. Do not trust already-contaminated shared cache bytes or repair them by allowing another hash. Checks passed: frozen install from the fresh private cache, prepare:assets, TypeScript, paired binary build, 14 Pi-host/assets tests (376 expectations), and staged/unstaged diff checks. Hosted full CI will rerun on push; the earlier full gate and copied-session evidence remain in the original fix note. No new full-suite or provider-continuation claim.

Values unchanged. This is a mainline merge; existing cache-isolation and measured-startup lessons cover it. No real journal or production install is touched.
