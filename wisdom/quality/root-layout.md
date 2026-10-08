# Consolidated root layout

Branch: bruv/consolidate-repository-root-layout-1cb32e3b.
Worktree: /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_1cb32e3b.
This is a new follow-up, not another historical-output sweep.

Reviewed inputs c70562a0371e8e5946e614f9ee0f47a1ecca2a9d and 561e3b8c
are integrated as 523f5523 and 23702ffe. Legal inputs belong in
licenses/third-party; completed captures retire to Git, and new CI history
collectors use ignored artifacts/ci-history.

PRODUCT.md and ARCHITECTURE.md belong in docs/. The product record gains only
a historical-status banner and working navigation, not revised decisions.
All 69 release notes belong in docs/releases; preparation, selection, publication
and tests use that home without a compatibility copy. The only other support
file is the unchanged GPT-Live explainer in docs/historical, with a snapshot label
in its directory README. README, CONTRIBUTING, LICENSE, THIRD_PARTY_NOTICES
and tool configs remain root entry points.

Before edits, all 72 moved document files and all nine curated license inputs
matched their original Git bytes exactly. Release notes and HTML remain unchanged.
Relative links in the moved Markdown resolve. Focused architecture, release and
notices tests: 64 pass, 629 assertions; offline CI-history collector test: 1 pass.
Notice generation reproduces THIRD_PARTY_NOTICES.md and writes 211-package
license payload to ignored dist/release. Format passes after formatting the
reviewed license generator; lint passes with existing warnings.

Generated-output lane (integration pending): branch bruv/generated-output-homes-42b79a47,
worktree /home/tnfssc/.bruv/worktrees/t3-53f4b259-5442693331ce-task_1cb32e3b-5442693331ce-task_42b79a47.
It traces assets and retained-run contracts; parent owns final integration and
build/typecheck/packaging proof. No ignored local data was deleted or migrated.
Old generated paths in another checkout may remain until their owner safely
migrates them. No push, PR or release requested.

Values unchanged: clear ownership, safe user data, honest proof and compact
handoff already cover this work. The earlier layout note’s root-doc/support
choice is historical and superseded here; historical receipts are not rewritten.
