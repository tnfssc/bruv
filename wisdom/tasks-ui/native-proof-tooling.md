# Agreed compact tasks UI: native proof tooling

Scope: tooling only. No implementation, footer, or expanded rendering edits. Based on rebased draft 7627cdc on origin/develop bada7e5; the draft is not final UI acceptance. Read the full authoritative discussion checkpoint in task_6b26afdc and values.md; later single-line failure/background approvals supersede earlier layouts.

Durable worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_77080c99-a86675007a5e-task_b0cca465
Branch: die/native-pty-capture-scenario-tooling-b0cca465

## Code and mechanics

- scripts/tasks-ui-proof-build.ts compiles the actual src/cli.ts with Bun.build and a read-only owned link to the actual cached web archive (never copies through a shared cache symlink). It verifies cached Pi adaptations read-only and copies normal runtime assets into this worktree (no dependency patches), requires clean tracked source, and records the source commit, binary SHA-256, archive SHA-256 and Bun version. The archive has no manifest; none is forged. This is local native proof, explicitly not a package/release build.
- scripts/tasks-ui-native-proof.py launches that binary in a private 110×40 tmux PTY, with disposable HOME, cwd, temp/config directories, an environment allowlist, session-only --approve trust for that owned fixture cwd (no real/global trust changes), and loopback-only fake OpenAI SSE inference. Seven bounded requests use actual SDK streamed arguments and tool execution. Capture acknowledgements gate spinner-only, partial label, full label while code arrives, code-first partial JSON, and the background launch result before follow-up narration. A real executed foreground barrier and real shell background barrier separate running from terminal state. It captures success, concise failure, static background launch/running/same terminal row, hidden thinking, collapsed-notice absence, Ctrl-O source/output and footer fields. It does not fail early on appearance assertions: keep all stages for review.
- scripts/tasks-ui-proof-screenshots.ts screenshots every exact full native viewport with installed cached Chromium/Playwright. These are ANSI terminal-replay screenshots, not desktop photographs. No redaction, cropping, invented UI, text substitution, or pixel editing; the helper asserts browser text equals the complete captured viewport. Full native ANSI/plain viewport and scrollback files remain authoritative; PNG hashes, browser/font hashes and tooling hashes are recorded.
- tests/tasks-ui-proof-tooling.test.py tests serialization/gates, the actual loopback SSE server, seven-request bound, and the audit's ability to reject draft success, raw code leaks, duplicate/moved tasks and missing footer/expanded details. Its tiny strings test audit mechanics, NOT UI proof.

Screenshot mechanism finding: host /usr/bin/Xvfb cannot start (missing libnettle.so.9). Existing cached Chromium and playwright-core work; no system library/dependency mutation, download, or paid provider is needed. Use the disclosed ANSI replay mechanism, not an assertion of direct desktop pixels.

## Parent rerun after integration

Commit integrated tracked source first; use an absolute Bun path. Cached node_modules may be linked read-only; do not mutate it. Do not run package build/manifest generation. From the integrated worktree:

	test -e node_modules || ln -s /home/tnfssc/Code/die/node_modules node_modules
	export SHELL=/bin/sh TMPDIR=/home/tnfssc/.die/tmp-pi-removal
	export BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
	export PLAYWRIGHT_CORE=/home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs
	export CHROMIUM_BIN=/home/tnfssc/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
	python3 tests/tasks-ui-proof-tooling.test.py
	"$BUN" scripts/tasks-ui-proof-build.ts /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4a76ba31/dist/die-web.archive.gz /home/tnfssc/.die/tmp-pi-removal/tasks-ui-final-die
	python3 scripts/tasks-ui-native-proof.py --build-record /home/tnfssc/.die/tmp-pi-removal/tasks-ui-final-die.build.json --out /home/tnfssc/.die/tmp-pi-removal/tasks-ui-final-capture

Use a NEW capture directory per attempt. --no-screenshots is diagnostic only and deliberately cannot pass acceptance. Open ALL eleven PNG stages alongside their complete viewport/scrollback text. Do not cure defects by scrolling away, clipping, or editing captures. Parent owns final combined source compile and visual acceptance. The footer and expanded view captures/checks establish visibility, not a magical claim that unrelated source stayed unchanged: parent must inspect the integration diff/baseline too.

## Validation and handoff

Twelve focused Python mechanics tests passed; full tsc --noEmit passed; focused Biome checks/diff check passed (template-literal style suggestions are informational). Cached Chromium screenshot mechanics passed. Actual compiled draft source d8ce17c241edf443ad8459868f30eae70ab87552, binary SHA-256 05c6d356e5a52d9412a87245946b71145224af6579771e13fe464790aa2a0488, completed all seven bounded SDK requests and generated all eleven full native screens/PNGs. Captures: /home/tnfssc/.die/tmp-pi-removal/tasks-ui-tooling-draft-capture-v4 (earlier takes v1/v2/v3 are preserved, not acceptance). error is null and fixtureErrors empty; screenshot completeness, actual Ctrl-O source/output/expanded notice, footer visibility and quiet executing/executed checks pass.

The draft correctly FAILS new appearance acceptance: plain success, raw code-first leakage, missing action spinners, Thinking... placeholder, collapsed notice, old background launch and separate task-ID completion remain. Viewed actual PNGs for label/code stream, expanded Ctrl-O, foreground success, background launch-before-narration and background terminal. Latest native run also verifies the corrected background launch gate completes without an inference/capture error and the owned fixture trust warning is absent. No claim that the draft is final UI. Native observations corrected two harness issues: don't count the editor activity spinner as the transcript spinner; expanded code wraps across terminal lines. Session-only fixture trust removed the unrelated trust warning (not scrolling it away). The final tooling additionally audits partial source leakage and secondary task-ID completion notices, uses a cached Nerd Font for prompt glyphs, and releases owned execution barriers on failure. Final integration appearance remains parent-owned. Capture build.json/report.json preserve the exact compiled source commit and binary hash, rather than silently treating the current HEAD as proof.

No push, PR, release, install, upload, real hosts, paid APIs, or dependency mutation. Values unchanged: existing values already demand real wiring, truthful proof and durable handoffs; the ANSI replay limitation is local proof-method detail, not a new general rule.

## Integration correction: untitled shell identity

The native scenario launches a real shell task; shell has no title metadata. The agreed fallback is its actual ID, not the execute label “Run tests.” The fixture now saves a bounded subset of the real typed shell launch response to background-task.json, audits that exact identity through ↗ → ✓ on the same physical transcript row, and separately rejects any residual checked launch action or second task notice. No product title is invented and no arbitrary model prose supplies task identity. Thirteen mechanics tests pass, including duplicate-launch rejection. Named task titles remain covered by the placed-root helper scenario and focused metadata tests.
