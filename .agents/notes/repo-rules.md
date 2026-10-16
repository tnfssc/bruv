# Repo rules (`AGENTS.md`)

## Changed on 2026-10-17, at the user's request

- Pi version list for compact spacing: replaced by `fits()`, a check of the Pi parts it wraps
  (see `compact-spacing.md`). Every Pi release turned the feature off, even when nothing it
  wraps had changed.
- Per-module line budgets and the 3,670-line total: dropped. They were guesses made before the
  code existed; source was already about 5,100 lines and several modules were over. Now: keep
  modules small and split them when they get hard to read.
- "Read `rewrite.md` (until merged)": the rewrite merged in PR #76. The spec's plan, spikes and
  list of deleted paths were removed (git history has them); the rest still describes bruv.
- "Test code no larger than source code": dropped as an arbitrary ratio that would discourage tests.
- "Squash-merge PRs": dropped; `develop` used merge commits anyway. Commit message style stays.
- Banned word list: replaced by "prefer the common word to jargon".
- Changing a running Pi: no longer limited to one file, and written as a value in `values.md`
  ("bruv builds on Pi; it never forks it") instead of a list of conditions. Shipping changed Pi
  files stays banned: bruv is a Pi package and has no way to ship them.
