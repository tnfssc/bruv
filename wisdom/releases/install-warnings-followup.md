# Local install warning cleanup

User requested completing v0.15.5 first, then fix each warning from scripts/install-local.sh, push directly to develop (no PR), and make another release. Do not change the running release input.

Worker task_04e6d0e5, worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_04e6d0e5, branch die/eliminate-local-install-toolchain-warnin-04e6d0e5, base 8ccc646. Reproduce full build/install with staged DIE_INSTALL_DIR, no actual user binary replacement, no placeholder web assets or blanket warning suppression. Inventory sources, fix causes, validate full pipeline. Parent reviews/integrates/pushes and releases separately after v0.15.5 finishes.

Current release run 36302402467, watcher task_304fffe7, log /tmp/die-release-v0155-watch.log. Check published assets/notes before claiming released. Values unchanged: this applies existing root-cause and truthful proof guidance.

Audit completed as 57e528e / integrated b10f4f3, full staged install and smoke pass but warnings remain. See wisdom/packaging/install-local-warning-audit-2026-09-27.md. Implementation orchestrator task_a478759f now owns actual fixes in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a478759f, branch die/fix-audited-installer-warnings-at-source-a478759f. It may delegate compiler/packaging/chunk work; must integrate and test fresh real build before parent review/push/next release. User already authorized fixes; do not stop at audit or ask again merely because warnings originate upstream. Current v0.15.5 remains independent.

Parent merged full remediation branch locally (not yet pushed). Independent reviews: task_a38f45aa dependency/deploy compatibility and task_90962200 compiler/chunk semantics. Fresh parent installer+smoke task_bed66b72 uses clean .cache/t3-parent-warning-review, staged artifacts/install-review/{home,bin,tmp}, logs install.log/smoke.log. Node 24.15.0 pnpm launcher, pinned pnpm from upstream. No actual user installation overwritten. Need review results, parent tests and remaining timing advisories assessment before next release.
