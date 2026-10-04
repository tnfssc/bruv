# Bruv web terminal setup guide

## Scope and workspace

2026-10-04. Branch: `bruv/format-bruv-web-setup-guide-e3953110`.
Worktree: `/home/tnfssc/.bruv/worktrees/t3code-2967b1c3-5442693331ce-task_e3953110`.

Reworked `src/t3/web/launcher.ts` to follow the six install-to-chat steps in
[the illustrated README](../docs/t3-code/README.md). The
[external T3 setup notes](external-t3-setup.md) remain the detailed contract.

## Choices

- Plain numbered headings, blank lines and indented commands/paths are enough.
  No renderer, dependency, TTY branch or ANSI styling; redirected output reads
  the same as terminal output. Long isolation/audio/protocol details are linked,
  not repeated in the quick guide.
- Connector binary and SDK history paths still derive from the current executable
  and user home. They are absolute in the installed command. Auth stays in the
  ordinary same-user Bruv home, distinct from native SDK transcripts.
- Keep the separate Claude protocol instance, exact custom and auxiliary model
  selection, ordinary independent T3 launch and no parent environment workaround.
- Keep the 2644 history/fork limit, explicit stale-approval Decline and paired
  update safety prominent. This edit does not establish a fixed T3 release or
  certify upstream history/fork behavior.
- `runWeb` remains output-only. No network, download, subprocess or settings
  mutation was added. Accepted `--help`, `-h`, `--setup` and invalid argument
  behavior are unchanged.

## Checks

- `bun test tests/t3/web-launcher.test.ts`: 3 passed, 0 failed. Updated the
  existing focused tests for step order, dynamic paths, important safety advice,
  guide links, plain output and flag behavior; no broad matrix.
- `bun run check`: passed asset preparation and TypeScript no-emit check.
- `./node_modules/.bin/biome format src/t3/web/launcher.ts tests/t3/web-launcher.test.ts`:
  passed after formatting the tests.
- `git diff --check`: passed.
- Ran `runWeb(["--setup"])` from source via Bun with stdout redirected to
  `/tmp/bruv-web-terminal-guide-e3953110.txt`: exit 0; headings and screenshot
  guide link present; no ANSI escapes. Reviewed the deterministic sample paths
  and printed guide. This is source-level presentation checking, not installed
  binary, provider-access or upstream T3 acceptance proof.

The local shell emitted a nonblocking mise untrusted-config warning; the checks
above still ran and passed. No trust/config change was needed or made.
Parent owns screenshots, release and broader acceptance. No push or release.

Values unchanged: this is a feature-local application of readable human flows,
small focused checks, honest proof boundaries and the simplest useful renderer.

## Parent integration

Main branch `t3code/document-bruv-t3code-setup-screenshots` combines the guide
with the screenshot README. Terminal steps now name the observed Add provider,
Identity, Config, Add instance and custom-model Add controls. Final local
frozen install, type check, focused 3-test suite, compiled pair build and
`dist/bruv web` redirected-output check passed. The parent initially lacked
node_modules; locked installation fixed the missing asset dependency.
Publication will use the normal PR and manual Release gates, not local assets.

PR #31 first full CI failed two compiled-output tests that still expected the old
opening phrase. The packaging smoke script also matched it. Updated those
assertions and their smoke fixture to the new "Setup guide only." marker.
Kept all standalone runtime and unchanged CLI/Claude/T3 state checks intact.
This is wording alignment, not a relaxed execution or release gate.
