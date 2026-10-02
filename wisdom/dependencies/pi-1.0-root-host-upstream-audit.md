# Root Pi 1.0 upstream replacement audit (2026-10-02)

## Scope and result

Independent root-host review for the authorized upstream-first migration. Parent
owns official T3 development source migration in
`/home/tnfssc/.bruv/worktrees/t3-upstream-first-4eb8a4a8`.
This review changes no T3 source, patch, pin, runtime code or tests.

**No concrete safe Pi 1.0 replacement found in the reviewed root host seams.**
Reduction: **0 runtime/test lines, 0 wrappers, 0 dependency patches** removed.
The four existing guarded host patches remain. Do not count T3 provider deletion
or the already-merged fullscreen-default deletion as a new root reduction.

Read [values](../values.md), [migration checkpoint](../t3/upstream-first-migration-checkpoint.md),
[Pi upgrade](pi-1.0-upgrade.md), native fast/cost/compaction/checkpoint guidance,
and disk-history/scan-abort guidance. Compared installed Pi 1.0 declarations and
runtime sources with the pristine published-package reference retained by the
upgrade task at `/tmp/bruv-pi-review-275c67be/100/package`.
Every pristine host file passes the existing original/adapted hash validation;
this audit did not write into the shared SDK installation.

## Concrete findings

- **Built-in filtering / command removal** — `scripts/pi-host-adaptation.ts`,
  `src/pi-host.ts`: upstream `dist/main.js` constructs
  `[...builtInExtensions, ...(options?.extensionFactories ?? [])]` (line 451).
  `MainOptions` exposes only additional factories, not a builtin filter.
  `--no-extensions` disables discovery as well; explicit `-e builtin:<name>`
  selectors and trusted project overrides can re-enable inherited builtins.
  They do not replace registry removal while preserving user extensions and
  llama.cpp. Nor do they remove the separate upstream `mcp` CLI dispatcher/help.
  Existing tests exercise both selector and project-override paths.
- **Session scan cleanup** — pristine 0.99.1 and 1.0.0
  `dist/core/session-manager.js` have identical SHA-256
  `046b6a1109ac3f0ed893bb85bf0648709362fa926a5da75761216cf2fcf9d926`.
  The unowned read stream inside `createInterface` and iterator early return
  still need explicit error ownership and finally-close/destroy. There is no
  upstream replacement for the scan patch. The SDK whole-file history manager
  also still retains `fileEntries`; it does not replace
  `src/history/session-manager.ts`'s bounded body cache, collision-safe
  publication and rollback semantics. See [disk history](../history/disk-backed-history.md)
  and [scan abort](../history/resume-scan-abort.md).
- **Startup / editor / density** — `src/ui/startup.ts`, `editor.ts`,
  `conversation-density.ts`, `quiet-tool-ui.ts`: native
  `InteractiveMode.init` starts UI before awaiting terminal colors and extension
  initialization (lines 699–705). `setEditorComponent` at session_start still
  cannot replace the first paint. Public border hooks already drive the compact
  editor; they do not remove border rows or remap its mouse coordinates. No
  public constructor settings replace the density/hidden-thinking/status choices.
  Upstream fullscreen is already adopted unchanged; no regular-default shim
  remains to delete. New user Markdown shape was already adopted during upgrade.
- **Native fast guard** — `src/agent/native-fast-mode.ts`: upstream
  `serviceTier` supports serialization, not durable human authorization,
  captured request identity or validation after all payload hooks. In
  `dist/core/extensions/runner.js`, `emitBeforeProviderRequest` catches handler
  exceptions and returns the current payload (lines 1060–1087). Replacing the
  runtime guard with that public event would silently weaken the no-dispatch
  boundary. The runtime-instance wrapper remains necessary; no new fallback or
  provider-wide monkey patch is proposed. Some comments still name the original
  Pi 0.85 seam; that is not evidence of a replacement in 1.0.
- **Native compaction** — `src/agent/native-compaction.ts`: upstream Responses
  converters support replaying opaque compaction items, already used here. That
  is not an upstream operation replacing checkpoint validation, coverage,
  persistence, stale-owner/model checks, or explicit standard-tier dispatch.
  The examined Pi AI API declarations do not supply an equivalent native
  compaction lifecycle. No ciphertext flattening, origin relabeling or safety
  deletion is warranted. See [checkpoint switching](../native/codex-compatible-checkpoint-switching.md).
- **Remembered root CLI choices** — `src/agent/last-used-cli-model.ts`:
  upstream `InteractiveMode.cycleModel` and `cycleThinkingLevel` still invoke
  session methods without persistence flags (lines 3631–3644), while some pickers
  explicitly persist. Session APIs offer opt-in persistence, but it does not
  replace remembering root TUI cycles while excluding restores and children.
  The wrapper already delegates settings writes to upstream SettingsManager.

Bruv execute/tasks/questions/remote/history ownership remains untouched. Pi's
builtin codemode/MCP/tool-search are not equivalent replacements for their
human ownership, placement and durable task safety. This result is confined to
root Pi 1.0; it does not argue against parent reducing the separate T3 adapter.

## Proof and limitations

Focused existing regressions: **89 pass, 0 fail, 488 assertions**, eight files:

```sh
bun test tests/pi-host.test.ts tests/native-fast-mode.test.ts \
  tests/native-compaction.test.ts tests/last-used-cli-model.test.ts \
  tests/history-sdk-099.test.ts tests/history-projection-parity.test.ts \
  tests/history-storage-io.test.ts tests/history-publication-collision.test.ts
```

Bun 1.4.2 was selected by absolute path and added to PATH for child fixtures.
Dependencies/runtime-assets were temporarily symlinked from the existing main
checkout; no install or prepare ran and no user settings changed. Compiled host
checks reused the prior fullscreen-default worker's CLI:

- Artifact: `bruv-5442693331ce-task_61242e1b/dist/bruv`.
- Commit: `95616b8b6559c42d91472e5a489af3045867e5b1`.
- SHA-256: `b6e0df0df5c744aa634349195602f2574149b946e579955aba0c0e148a3b35e9`.
- Root `src`, `scripts` and `bun.lock` match this audit's baseline; package
  metadata differs only in 0.15.23 vs 0.15.24. This is reused behavioral evidence,
  **not a fresh build or current-version packaging proof**.

First run: 85 pass / 4 fail because Bun was absent from PATH for two subprocess
fixtures and the worktree had no compiled CLI for two checks. Correcting only
those local test resources produced the above clean rerun, without changing or
skipping assertions. Logs: `/tmp/bruv-root-pi-seams-1819db87{,-rerun}.log`.
Temporary links removed before commit. No live provider, rendered acceptance,
full-suite/build, push/release/version bump or product install was performed.

Values unchanged: 5/6 require bounded history and essential safety; 7/9 favor
actual upstream replacement, not deleting non-equivalent behavior to improve a
line count. This is feature-specific negative evidence, not a new general rule.
