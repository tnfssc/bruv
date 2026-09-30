# Composer editor startup lifecycle during CI speed rollout

2026-09-30. Product fix, not a selective-CI or browser-setup change.

## Evidence and ownership

Hosted develop runs 36761523355 (job 110048362625) and 36762688740
(job 110053095183, ec3ce32) independently failed the unchanged final Linux
release browser boot/reload gate. Both uploaded screenshots/JSON show the
**real app error boundary** on a draft route, with no successful initial pass:

    [tiptap error]: The editor view is not available. Cannot access view['dom'].
    ComposerPromptEditor-Cag95oJh.js:89:4217
    ComposerPromptEditor-Cag95oJh.js:134:18292

Downloaded the first run's actual binary (SHA256
184b0cff3b898ecdd8767d2c5e1aa98bb53541101715b37030b54660cfbab544)
and both browser proof artifacts into isolated durable evidence directory
`/var/tmp/die-browser-race-36761523355`. The second proof's binary SHA256 is
049409c63e058b4a4fe34ec78e528598c4e699ce86d735fcd79d06b09404f186.
Fetched the first binary's served emitted asset: line 134:18292 is exactly
`let o=w.view.dom` in the controlled-value **layout effect** of
`apps/web/src/components/ComposerPromptEditorTiptap.tsx` (source line 1051).
Line 89 is Tiptap's no-view proxy throwing on DOM access.

This effect checks only that the editor object exists. It is unchanged in
upstream pinned HEAD b488c57f3f9f1688e31c53daee99e29dd1d0baa2; no previous Die
patch hunk owns this file. Therefore the invalid lifecycle assumption predates
the CI rollout. The owning fix belongs in the maintained upstream patch, with
the pin unchanged, not in CI selectors, workflow, or browser setup.

Tiptap's useEditor creates an instance during render, schedules its destruction
after 1 ms if its passive mount effect has not run, and recreates destroyed
instances in that passive effect. A returned editor object is not proof of an
available view. Core destroy/unmount clears the view and isInitialized;
`isDestroyed` is true when the view is absent. The adjacent attribute layout
effect already guards isInitialized; the controlled-selection effect did not.
The scheduling mechanism explains how an instance can retire before layout,
but the precise hosted scheduling sequence was not instrumented/proven. The
stack alone does not distinguish a destroyed instance from one not mounted
yet: core isDestroyed is true for both when the view is absent. The guard and
regression explicitly cover both rather than asserting which occurred.

The browser gate is byte-identical to v0.15.14's. New setup pins the same
Playwright 1.60 headless shell and avoids redundant apt upgrades; no evidence
of a different browser executable or invalid harness operation was found.
The exact failed binary passes the unchanged gate locally, also with a diagnostic
8x CDP CPU slowdown. Concurrent slow-sibling/Suspense fixtures in development
and production did not reproduce the natural race. **Do not claim a local
natural-timing reproduction, or that changed host libraries/timing cannot
expose it.** Two hosted failures and the emitted/source instruction establish
the existing product lifecycle defect, not the exact timing trigger.

## Minimal fix and deterministic regression

The controlled-selection layout effect returns for null or destroyed/unmounted
editors **before** changing the initial-selection flag or snapshot. Tiptap's
replacement rerender applies the first selection normally. No try/catch,
console filtering, delay, retry, dependency upgrade, or initialized-only guard
(which could miss the initial cursor) was added. Existing mounted editor behavior
and the adjacent geometry effect remain unchanged.

The canonical patch also adds ComposerPromptEditorTiptap.test.tsx. It uses
Tiptap core's actual never-mounted and destroyed Editors and throwing view
proxies, mocks only the
React hook/content boundary, and replaces the retired instance with a live
selection fixture. Both plain/rich modes prove:

- no access to the unavailable view;
- the pending initial cursor still applies to the replacement;
- no stale onChange emission;
- unfocused cursor-only updates still do not focus/move the live selection.

Before the guard, the regression cases fail at the same product layout-effect
DOM read and actual Tiptap exception. With the guard, four focused upstream
files pass **172 tests**, plus upstream web tsc --noEmit. Prepared dependency store lockfile is byte-equal
to the canonical source pnpm-lock.yaml; no install was performed. Root source-verifier
unit test (1 test), root tsc --noEmit, exact source verifier, production browser
build, and maintained static chunk-cycle build gate pass.

## Packaged proof and limits

Candidate SHA256:
3530cf8c89529a2a85bfd35b1f4f0d84e7009a88663e63ad6ae016812ff6fc57.
Embedded archive SHA256:
0c2785a48d1a65737e9a8f8a69404247fe9782cfc9942d1ce60bd7c68c1f3107.
Built the production client from isolated pinned HEAD + canonical patch,
recomposed it with the **unchanged downloaded backend**, then compiled through
maintained scripts/build.ts --reuse-web using Bun 1.4.2. This is an isolated
client-fix candidate, not a fresh full native/deploy release build.

The candidate passes the unchanged release-browser gate (initial + reload,
zero console/page errors). Additional actual packaged-browser proof uses two
cold contexts, each reloaded: waits for visible contenteditable ProseMirror,
types into the composer, asserts the resulting text, waits for startup effects,
and requires zero page/console errors on all four loads. No model call or
credentials. Logs/scripts/JSON remain in the evidence directory.

Setup limitations recorded honestly: first gh download exhausted /tmp; reran
with TMPDIR=/var/tmp. Initial candidate compilation lacked generated runtime
assets; maintained prepare-assets followed by build succeeded. First manual
mounted-editor check ran before the socket enabled editing; corrected readiness
to visible contenteditable=true (not a relaxed mountedness assertion). Full
repository tests and hosted fixed-candidate validation were not run. No install,
push, dispatch, release, gate retries, or workflow/setup edits. The second
hosted run was not canceled.

## Wisdom

Read values and [previous released browser startup failure](v01512-browser-startup.md).
Values remain unchanged: values 1 (finish the real behavior), 2 (honest proof), 3 (ownership), and 10
(durable proof/limits) already cover this lesson. A passing browser startup is
one schedule, not proof of lifecycle safety. Keep real rendered acceptance and
add a deterministic invalid-lifetime regression rather than retrying the gate
or hiding console errors.

## Hosted closure

Parent integrated this as c32a42b and pushed with9745aa1. Hosted full CI36770807934 passed. Release dry-run36770807953 passed its unchanged final Linux browser initial boot/reload gate and actual Mac/updater gates. This closes the observed hosted blocker without suppressing console errors. No new release was published by the dry-run.
