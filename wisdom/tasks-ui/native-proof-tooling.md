# Agreed compact tasks UI: native proof tooling

Scope: tooling only. No implementation, footer, or expanded rendering edits. Based on rebased draft 7627cdc on origin/develop bada7e5; the draft is not final UI acceptance. Read the full authoritative discussion checkpoint in task_6b26afdc and values.md; later single-line failure/background approvals supersede earlier layouts.

Durable worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_77080c99-a86675007a5e-task_b0cca465
Branch: die/native-pty-capture-scenario-tooling-b0cca465

## Code and mechanics

- scripts/tasks-ui-proof-build.ts compiles the actual src/cli.ts with Bun.build and the actual cached web archive. It requires clean tracked source and records the source commit, binary SHA-256, archive SHA-256 and Bun version. The archive has no manifest; none is forged. This is local native proof, explicitly not a package/release build.
- scripts/tasks-ui-native-proof.py launches that binary in a private 110×40 tmux PTY, with disposable HOME, cwd, temp/config directories, an environment allowlist, and loopback-only fake OpenAI SSE inference. Seven bounded requests use actual SDK streamed arguments and tool execution. Capture acknowledgements gate spinner-only, partial label, full label while code arrives, and code-first partial JSON. A real executed foreground barrier and real shell background barrier separate running from terminal state. It captures success, concise failure, static background launch/running/same terminal row, hidden thinking, collapsed-notice absence, Ctrl-O source/output and footer fields. It does not fail early on appearance assertions: keep all stages for review.
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

Eight focused Python mechanics tests passed. Cached Chromium screenshot mechanics passed on a disclosed synthetic SGR screen (not native acceptance). Native mechanics validation on the draft is pending at this note's initial commit; final integration appearance remains parent-owned regardless of that result. Capture build.json/report.json preserve the exact compiled source commit and binary hash, rather than silently treating the current HEAD as proof.

No push, PR, release, install, upload, real hosts, paid APIs, or dependency mutation. Values unchanged: existing values already demand real wiring, truthful proof and durable handoffs; the ANSI replay limitation is local proof-method detail, not a new general rule.
