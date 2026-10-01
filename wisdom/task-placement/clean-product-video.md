# Clean task-placement product demo

The old PR15 clip was real proof, but not a clean product demo: fixture markers, internal queries and test jargon were visible. Do not defend that presentation by observing that fixture strings are outside production source. Preserve acceptance fixtures and original evidence; make a separate natural-language scenario.

## Deliverable and provenance

Durable output: /home/tnfssc/.die/probes/task-placement-clean-product-video.

- task-placement-clean.mp4: 74 seconds, 1600×1200, H264/yuv420p, faststart. Retimed **new actual PTY snapshots**, not continuous live keystrokes or an invented terminal.
- Reviewed binary: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c/dist/die-task-placement-final; SHA256 e7dd04755a529eab1f6ba58dbd132a6997eed07b1b84604e3d473114fea21282; source b0dc1a1, lifecycle-fixed, production same as shipped19 except version bump. This tooling checkout is separate from binary source. No release source was changed.
- Cached base die-remote-e2e-2434886-5027:latest, image sha256:fcdfb61636ab08c6d03963acf07b90747dfdba02bd79182a99740ff483dc090f. Docker network:none; local exec SSH proxy; deterministic server fake inference; empty local provider config. No real hosts, paid APIs, user credentials, download, upload, push, PR or release action. Generated disposable SSH keys are removed with setup.
- Named server studio: authorization separate; root asks a normal helper to review a guide, ordinary /ps and /questions pickers, actual detach/reopen with the same saved question, human choice, real NOTES.md write and safe source return. Child target is omitted (inherits server placement), worktree explicitly requested. Authoritative jobs.list receipt proves normal/depth1/completed and a distinct server worktree. No separate local-parent placement scenario.

## Reuse

Run with the explicit reviewed binary and an external output directory:

    DIE_BIN=/path/to/die-task-placement-final REMOTE_ROOT_PLACEMENT_ARTIFACTS=/external/clean-demo bun scripts/task-placement-clean-capture.ts
    python3 scripts/task-placement-clean-video.py --output /external/clean-demo
    bun test scripts/task-placement-clean-scenario.test.ts

Capture tooling reuses only isolated SSH/image transport from the acceptance fixture. Separate scripts/fixtures/task-placement-clean supplies natural prompts, titles, model names and meaningful guide/notes output. It does not change acceptance assertions or fixtures. Every tool action executes in the compiled product; success is refused after a failed notes write. Verification requests and generated receipts are offscreen. No raw RootCommand/UI RPC or diagnostic status-query user prompts are introduced.

## Inspect what viewers see

The renderer checks every original terminal capture and **all 370 frame inputs**, hashes them, records exact findings in all-frame-audit.json, fully decodes the MP4 with ffmpeg, and checks H264/yuv420p plus moov-before-mdat. All eight distinct rendered states were inspected visually via showImage. Marker scans include PLACEMENT_*, ROOT_*, test names, raw saved-answer JSON fields, failures and automation exit chrome. This is not merely a source/hash/codec check.

Original viewport captures, full scrollback, server journal, inference requests, child placement proof, returned NOTES.md, receipt and failed producer attempts stay durable. Only disposable HOME prefixes are substituted in rendered text; no failure/result text is deleted or changed. Captions do not claim live capture. Tool code previews and ordinary product status/artifact paths remain visible, with natural action labels rather than assertions or test dumps.

Important limits, not hidden cleanup:

- The current root presenter **still projects saved-answer internal JSON into full scrollback**, despite the message being internal. No production change was authorized. Diagnostic scrollback is retained and the audit reports those findings. It is absent from the final captured viewports because the ordinary finished-notes preview occupies the actual terminal. Do not claim the product itself is debug-free.
- Actual PTY starts 120×32 and expands live to 120×44 for finished notes and return; it is not an invented viewport. Original successful-detach snapshot contains tmux's status0 dead-pane overlay. It is kept/audited as automation-only evidence, not a rendered state. Final clip shows the real question picker before detach and after reopen. Reusable producer suppresses tmux exit chrome. No failed outcome was omitted from a supposedly successful take.
- Two failed producer attempts are preserved separately (string quoting, then array question-list shape); neither supplies final frames. Final recording tools and source return succeeded. Its harness then failed an incorrect journal substring check for worktree intent. Recovery used the untouched actual jobs.list receipt (workspace/type/depth/status), not a guessed outcome; failure.txt/harness.log remain. See receipt's postCaptureVerificationCorrection.

Parent owns visual approval, upload and PR15 replacement. Old acceptance source proof remains separate. A clean rendered clip does not erase the genuine product metadata finding above.
