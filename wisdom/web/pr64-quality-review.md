# PR64 quality review

Review the whole branch against develop, not only the Ghostty swap. The user sees too much generated clutter and wants a careful, coherent cleanup. Keep one PR64. Do not merge or install. Starting head: f54a51c7. The diff is 132 files, 16,283 added lines and 92 removed lines, including required third-party licenses. Line count alone is not a quality measure.

Six independent read-only reviews cover architecture, browser code, backend/voice ownership, Ghostty/packaging, tests/probes and docs. Reports go in .tmp/review/. Parent checks findings against code and chooses edits; reviewers must not turn guesses into requirements. Preserve the real PTY, shared input/output with local navigation, explicit voice ownership, direct controls, renderer and security. Remove duplicate state and unnecessary machinery, not useful behavior or assertions.

Next: combine concrete findings into a small edit plan, delegate non-overlapping slices, inspect the combined product, and publish code plus durable notes to PR64. Existing values cover small design, clear owners, honest proof and durable notes; reassess after the review.

## Accepted changes

Keep the core owners: server registry, PTY sessions, browser-local navigation and attachment-owned voice. Do not replace them with controllers or a new UI store. Remove the unused server plugin API, test-only async authorization, old modal name editor and T3 launcher wrapper. Move meaningful VM browser assertions into real-page checks before removing its handwritten DOM. Consolidate overlapping probes and obsolete notes. Required licenses stay.

Concrete defects found: replay and multiple viewers can send duplicate protocol replies; touch ignores normal-buffer mouse mode; legacy overflow mouse targets the wrong cell; drawer focus can escape; audio close can finish before teardown; phone rename overrides field size and loses panel labeling; expired tokens reconnect forever. Fix these with bounded ownership and existing state, not a new generic layer.

Edit owners: docs task_94720e78; browser controls/audio close task_98c9eda9; renderer touch/legacy bounds task_1b7bc8d2; terminal reply ownership task_27586004. Parent owns launcher wording/wrapper removal and integration. Backend and test reviews still need final decisions. All worker branches start at f54a51c7; integrate only their owned changes.

Parent fixes: one shipped launcher, owner-tab stop wording, authenticated state recheck after failed event socket, bounded UTF-8 input frames and native paste through mode-aware Terminal.paste(). A real browser/raw PTY received 165,012 bytes exactly, remained usable, kept its PID on reconnect, and stopped retrying after same-port token replacement. This also exposed and fixed Ghostty native paste bypassing bracketed mode. Renderer tests use the existing Bun runtime rather than adding Python. Browser test worker must preserve these regression cases in the maintained gate before retirement of old harnesses.
