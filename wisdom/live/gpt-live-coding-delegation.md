# GPT-Live coding delegation (2026-09-26)

The primary GPT-Live socket sends client delegation ID and offset only. No tool names, arguments, or final ASR arrive. Keep its fragments provisional, bounded and time-filtered in GptLiveDelegationBridge; never execute a fabricated tool call from voice metadata. The bridge dispatches a data-labeled snapshot to the existing MainOwner, which runs the selected ordinary Pi session agent through its own run loop. The configured model, instruction frame, extension tool hooks, session manager, permissions, and history stay canonical; the voice model is not another coding authority. Typed input uses that same owner directly. Duplicate delegation IDs map to one Promise. Closing voice prevents further admissions but waits for admitted agent work; barge-in only affects audio, not jobs. Explicit stop-work still uses its separate foreground/work cancellation path.

The existing GPT-Live playback recovery uses a bounded scheduler and provisional local acoustic thresholds, not proven VAD or server response boundaries. Real-device barge-in, paid provider delegation, and acoustic quality are unverified. Focused tests use a fake socket/provider and main-owner fixture; typecheck passes. If the paired model run fails, host reports failure and does not retry the work implicitly. Selected GPT-Live config/provider registration belongs to the provider owner and must be enabled alongside this bridge.

Values unchanged: existing one-owner, bounded context, truthful provisional data and stop semantics already describe this decision.

## CI follow-up (2026-10-10)

PR #71 failed on Linux and macOS in `live-paired-runtime.test.ts`. The backend did wake. The stream mock expected `customType: "task-complete"` in the provider request. Pi 1.1.0 keeps that field in canonical history but maps custom content to a provider `user` message. Pi caught the mock's failed assertion as a model error, so the test only reported a missing reply after eight seconds.

The test now captures both boundaries. Context and saved history must keep one real user request and one custom completion. The provider must receive the completion text. Three model calls, one delivered notice and the coder's reply prove the duplicate notice did not run twice. Assertions run after the owner drains, outside the stream mock; owner and model errors are checked directly. No product behavior, timeout or CI gate changed.

The full local `bun run ci` passed: format, lint, typecheck, both resource profiles, paired build, offline transport, 3,166 tests and standalone smoke. The 31 opt-in cases stayed skipped. Hosted Linux and macOS checks still need the pushed commit.

This applies to tests at the Pi provider boundary. A wire role is not the original message's source. Existing values on honest proof and waiting for owned work cover the lesson; no new value needed.
