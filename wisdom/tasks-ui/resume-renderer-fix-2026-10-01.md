# Task row adaptation after in-app resume and reload

## Cause and fix

The v0.15.21 adapter only caught Container.addChild. Pi 0.99.1 builds the new transcript before binding extensions on in-app /resume. /reload also rebuilds before session_start. Shutdown correctly removed the old adapter, so that rebuild missed the next install. Cold --session startup binds first and did not show the bug.

Parent research is in resume-renderer-order-2026-10-01.md (read directly from the parent working copy; parent owns that note).

Keep the fix in src/ui/sdk-task-rows.ts, not a Pi dependency patch. Hook Container.render as well as addChild. Just before Pi renders a container, adapt its existing tool/custom message children. Nested containers reach the same hook through Pi's normal render calls. The adapter's WeakMap makes repeat renders idempotent. No tree registry, cached rows, saved ownership changes, or session-lifecycle reorder is needed.

Inspected Pi's actual Container in node_modules/@earendil-works/pi-tui/dist/tui.js. It calls child.render on every render and records child heights for mouse dispatch. Delegate to the original method so that layout bookkeeping stays Pi-owned.

CustomMessageComponent inherits Container.render. When wrapping one, save the underlying original render, not our installed hook. Otherwise uninstall would restore an old session closure on that instance. Uninstall restores both prototype methods and every live adapted child. New installs read only their own snapshot callback.

## Checks

- Before the fix, build → install → render reproduced the execute label at launch and terminal rows among later replies. Install → build → render passed.
- bun test tests/task-rows.test.ts tests/execution-previews.test.ts: **51 passed**, 273 assertions.
- Regression coverage uses three completions with replies between them, both install orders, a nested root, repeated renders without wrapper stacking, and expansion/collapse. Shutdown/reinstall reuses task and call IDs with different session snapshots and verifies original SDK methods are restored and the old callback is never read again. Already-built error and native Kitty-image components retain their useful output.
- bun run check: **passed** after preparing runtime assets.
- Biome formatting and git diff --check passed for the changed source/tests.
- Offline source CLI tmux fixture: cold --session, /reload, /resume picker to an empty session, and picker resume back all passed. Inspected visible 100×50 frames: Alpha/Beta/Gamma each appeared once at launch, before Reply one/two/three; the empty session had none of those rows. Private CLI exited via /quit; private tmux server was removed. This is a labeled persisted fixture, not a new natural task run or released-binary proof. Captures: /tmp/bruv-task-rows-source-XkMR8x/evidence/{cold,reload,empty-session,resume}.txt.

## Setup and remaining gap

This worktree initially lacked dependencies/assets. A shared-dependency probe and then a cached frozen install hit an unrelated Pi dist/main.js hash mismatch. A clean registry tarball for the pinned 0.99.1 matched the expected original hash; replacing only this worktree's package let normal prepare:assets and typecheck pass. No guard or dependency source was changed in the commit.

Full bun run build stopped in the web payload build because pnpm was not on PATH. The existing compiled-CLI TUI test could not run without dist/bruv; its initial attempt produced an empty frame. No installed-binary /resume acceptance or release build is claimed. Parent should run that acceptance after integration with the normal build toolchain. Do not substitute cold --session alone for picker resume.

Values unchanged. Values 2, 7, and 8 already cover honest evidence, a local fix, and real reopen/session-switch checks. This is a feature-local lifecycle recipe, not a new general principle.
