# Live feature-preserving reduction — 2026-10-02

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_a3641c68
Branch: bruv/cleanup-obsolete-live-internals-without--a3641c68
Baseline: d80d7058a2f5481f067586fd7042fe2746cff4ae. Implements live-01 through live-06 from the parent audit; live-07 is deferred.

## Done and kept

- live-01: Removed the unused six-tool companion factory, context coalescers, handoff callbacks/revisions, transport tool timers and typed handoff-failure mapper. Gemini and GA Realtime retain the shipped direct-main path, bounded calls/context/results, cancellation, response correlation and playback epochs. Transport defaults now use Bruv's ordinary root base, not the unused companion prompt. The companion Markdown and historical wisdom are kept.
- Setup diagnostics/paid acceptance use setupProbeOrchestration: it captures the actual registered execute declaration and supplies the ordinary Bruv root base. The stub always denies dispatch. No copied six-tool fixture or parallel execute schema remains. Normal production still takes the complete effective instructions and registered tool from MainOwner.
- live-02: Removed only the orphan timestamp grouper and its three tests. Shared TranscriptLog tests and the actual GPT transcript/history paths remain.
- live-03: Removed write-only provider model memories and modelForProvider. Old JSON extras are ignored, not selected; invalid active provider/model still fails. Atomic save, failed-save selection retention, all models, and credential-only provider selection remain covered.
- live-04: One queued backend-turn body owns running state, ordinary admission, prompt frame reset, reply extraction and release accounting. Callers still own IDs/signatures, notification dedupe, epoch/branch outcomes, provenance and synchronous onAdmitted. Closing voice preserves accepted work; stop-work still revokes queued backend work.
- live-05: Removed unread stderr counting (kept private draining), the never-filled presentation array and redundant generation assignment. Generation validation, waveform and TranscriptLog rendering remain.
- live-06: Removed the C push alias and Linux empty state callbacks; migrated all alias self-test callers to batch. Both Linux flush opportunities and polling state checks remain.
- Fixed the helper-case privacy/status assertions to inspect running, not the preceding provider fixture. Both cases remain.
- live-07 deferred: standalone sine regression is meaningful and manually runnable. Folding it adds math linkage/build/documentation work for only 0–7 estimated lines. Kept it and ran it unchanged.

No public Live command/provider, speaker-check, waveform, onboarding, mic-check, audio behavior or archive was cut. No edits to *-tui.test.ts or wisdom/values.md. Values already cover the relevant ownership and proof principles.

## Proof and exact commands

Dependencies are installed in this worktree, not linked to parent node_modules. Bun 1.4.2 frozen install passed. Untrusted mise config initially hid bun from PATH; direct Bun path and a local shell PATH fixed invocation, without changing shared setup. Standard asset preparation (bun scripts/prepare-assets.ts) passed and adapted only this worktree's dependencies.

With PATH including /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:

- Offline suite: unset BRUV_RUN_OPENAI_LIVE_ACCEPTANCE BRUV_RUN_GEMINI_LIVE_ACCEPTANCE BRUV_RUN_GPT_LIVE_ACCEPTANCE; bun test on all tests/live-*.test.ts, tests/openai*.test.ts and tests/gpt-live*.test.ts except *-tui.test.ts and live-tui-startup.test.ts. **364 pass, 3 paid skips, 0 fail; 45 files, 22,951 assertions.** No TUI/device/provider systems invoked.
- After adding UTF-8 wire-cap assertions: bun test tests/live-session.test.ts tests/openai-session.test.ts tests/openai-session-schema.test.ts tests/live-prompt.test.ts — **62 pass, 0 fail, 352 assertions**.
- After removing obsolete context waits and fixture companion names: bun test tests/live-tools.test.ts tests/openai-session.test.ts tests/openai-session-schema.test.ts — **57 pass, 0 fail, 317 assertions**.
- bun node_modules/typescript/bin/tsc --noEmit — passed. Biome format of all changed TS files and git diff --check passed. Biome lint of changed tracked TS files exited 0 with warnings/info (not a warning-free claim); new setup-probe.ts also checked.
- clang -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined native/live/AudioCore.c native/live/test-core.c -o /tmp/bruv-live-core-test && /tmp/bruv-live-core-test — core tests passed, including ll_self_test.
- Same clang flags with native/live/test-waveform.c and -lm — passed: mismatched=0, max_error=0, rms_error=0.
- bash scripts/build-live-linux-helper.sh /tmp/bruv-live-linux-helper; helper --self-test; python native/live-linux/tests/protocol.py /tmp/bruv-live-linux-helper; python native/live-linux/tests/backpressure.py /tmp/bruv-live-linux-helper — compile, self-test, hello/stop protocol and backpressure all passed. No start/device request sent.
- bun build --compile /tmp/bruv-live-offline-entry.ts --outfile /tmp/bruv-live-offline-probe && /tmp/bruv-live-offline-probe — entry imported probeOpenAITransport from this worktree and ran it. Full/mini session.updated and HTTP 401 privacy checks passed on loopback. This is a compiled diagnostic, not a full packaged CLI/release proof.
- With BRUV_REALTIME_SETUP_PROBE unset: bun scripts/probe-openai-realtime-setup.ts — expected exit 2 and explicit disabled message. Paid setup was not run.

Final logs: /tmp/bruv-live-suite.log, /tmp/bruv-live-final-focused.log, /tmp/bruv-live-final-fixtures.log, /tmp/bruv-live-final-lint.log. Earlier failed iterations were corrected (missing generated assets, diagnostic seam typing, obsolete companion fixture expectations); they are not acceptance proof.

## Integration, risks and reduction

Production/native/scripts: +141 / -556, net **-415** lines. Tests: +118 / -493, net **-375**. Total code/tests: +259 / -1049, net **-790** (wisdom excluded).

Linux host has no xcrun; macOS Swift/helper compile remains unverified. Real speaker/microphone, Pulse source-removal/virtual-device tests, paid upstream setup/billing, full packaged CLI and combined parent gates were not run. No claim about acoustic/device/provider acceptance. Keep the existing native/manual checks.

Diagnostic schema capture imports the ordinary execute registration, so source setup probes now require the standard prepared runtime assets, just as ordinary source CLI/integration tests do. This avoids a duplicate schema and is setup-only. If the parent wants an asset-free standalone probe, coordinate a pure schema export with the TypeScript-tool owner; no outside-scope source was edited here. The paid script imports this adapter only after its explicit opt-in gate. No required cross-owner edits otherwise. Parent should integrate and run the combined gate.

Changed files (all scope-owned):
- native/live-linux/main.cpp; native/live/{AudioCore.c,AudioCore.h,test-core.c}; scripts/probe-openai-realtime-setup.ts.
- src/live/{audio,config,extension,main-owner,openai-session,providers,session,types}.ts; added setup-probe.ts; deleted orchestration.ts, tool-failure.ts, transcript.ts.
- tests/{live-config,live-extension,live-long-audio,live-main-integration,live-main-owner,live-openai-provider.acceptance,live-prompt,live-provider.acceptance,live-session,live-tools,live-transcript,openai-session-schema,openai-session}.test.ts; deleted tests/live-orchestration.test.ts; this wisdom file.
