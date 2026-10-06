# Terminal measurement harness pickup

## Branch and provenance

- Branch: `bruv/terminal-measurement-harness`.
- Worktree: `/home/tnfssc/.bruv/worktrees/t3code-bbf9268f-5442693331ce-task_cd4f43cf`.
- Base: `origin/develop` = `2683847dec4344a458ae8d39146cd6b48f55959d`.
- Source: combined commit `134f7bcd8ceefc9c4037779f37e9eee438e7b1d9`, branch `t3code/terminal-ui-frame-performance` in `/home/tnfssc/.t3/worktrees/bruv/t3code-bbf9268f`. Path-based extraction, not a cherry-pick of optimization commits.

Only measurement scripts, fixtures/tests, guide/wisdom, a README link and the two package scripts are included. All runtime `src/**`, SDK patches, lockfile, production tests and dependency configuration remain base-identical. No shipped performance improvement is claimed. Old results, profiles, JSON evidence, optimization-only selector behavior/count tests and production-fix wisdom are excluded. Standalone disk callback/journal/stop probe source is retained without historic artifacts.

## Compatibility changes

The lifecycle probe uses real unchanged SDK selectors; it no longer imports/installs the combined branch missing `src/history/selector-lifecycle` optimization. Tool tests assert develop work: two historical document renders on complete, three on reveal including anchor work (rather than optimized one/one). Visibility, content, output, event ordering, journal, lifecycle, provider/network prohibition and timing-boundary assertions were not relaxed. Profiler wrappers are fixture-owned; no production instrumentation is added.

## Verified locally

Bun 1.4.2 on Linux. Functional/small coverage checks, not authoritative performance comparisons:

- `bun install --frozen-lockfile && bun run prepare:assets && bun run check`: passed.
- `bun test tests/terminal-perf-*.test.ts tests/terminal-interactions-*.test.ts scripts/terminal-perf/interaction-tool-events.test.ts`: **120 pass, 0 fail, 5,186 assertions**, 13 files.
- `bun run perf:terminal --case input --scales 100 --samples 2 --warmup 1 --out artifacts/terminal-perf/extraction-smoke`: exit 0; one cold plus two measured changed frames retained. Cold frame exceeded 8 ms.
- `bun run perf:interactions --cases send/short,send/bruv-short,tools/events/normal,tools/events/error,tools/short,navigation/scroll-page,navigation/lifecycle --out artifacts/terminal-interactions/extraction-smoke`: exit 0; seven fresh serial case processes, 31 stage/report samples. Real event burst/error and subscribed input, SDK/Bruv Enter, all short-tool stages, scheduled component navigation and initialized lifecycle covered. Observed misses remain reported (event cases, tool setup, navigation cold).

Commands ran one at a time, after the focused suite. No full slow matrix or high-sample profiling. Local smoke artifacts are ignored, uncommitted and from a dirty extraction checkout: functional evidence only. Larger standalone disk/journal/stop probe matrices were typechecked but not executed. No production suite/build/PTY acceptance was run because runtime is unchanged; no responsiveness claim rests on these tests.

## Setup issue and resolution

Inherited/shared Bun cache contained modified SDK `session-manager.js` bytes: ordinary reinstall first failed asset preparation supported-host hash check. Resolved without runtime/patch edits by reinstalling into a private cache with copyfile backend:

```sh
export PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:/usr/bin:/bin
rm -rf node_modules
bun install --frozen-lockfile --cache-dir /tmp/bruv-terminal-harness-bun-cache-cd4f43cf --backend=copyfile
bun run prepare:assets
bun run check
```

Subsequent ordinary frozen install/preparation/check passed. Shell emits a mise untrusted-worktree notice; the actual Bun executable in a Bash PATH avoids shim reliance without config changes. Do not edit hardlinked vendor cache files. No remaining functional blocker in exercised paths. Budget misses, missing contiguous boundaries and unobserved continuations are limitations, not hidden successes.

## Next pickup

Inspect this commit against the pinned base; parent publishes after review. No push or PR made. For matched timings, commit first, keep a quiet machine and identical fixture/config/content, then run serial selected cases. Strict budget mode is only an opt-in observed-scope gate. Read [usage](../../scripts/terminal-perf/README.md), [coverage/gaps](terminal-interaction-lab.md), [report accounting](terminal-interaction-runner.md), and [fixture lifecycle](terminal-perf-fixture-lifecycle.md).

Wisdom describes harness-only methodology/usage/extraction instead of combined results. Value 2 adds whole-action, missing-timing and like-boundary measurement principles, with existing links and no shipped-fix claim. Base async-fixture ownership value preserved.
