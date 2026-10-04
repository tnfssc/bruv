# Steering wire research evidence

Read ../../steering-wire-contract.md for findings and limits. Research fixtures, not a Bruv/Pi/Gemini product test.

- wire.sanitized.ndjson: actual ACP envelopes; runtime instructions omitted with hashes, injected host bearer redacted.
- ui-commands.json: actual rendered Queue/Steer/Stop browser commands, no pairing/login frames.
- projection-summary.json: final retained run/attempt/session/queue identifiers and statuses.
- 04-* / 05-result.json / 09-*: queued Steer and settled Stop UI, with labeled mock work.
- identities.json, source-excerpts.txt: exact binary/source/package identities and cancel/dispatch implementation.
- native-boundary.mjs/json: real installed Agent-core with mock tools/provider stream. Run from repo with bun wisdom/acp/proof/steering-wire/native-boundary.mjs; writes native-boundary.json here. No network/provider use.
- fixture.mjs: ACP v1 mock; copy into an owned scratch directory before launch. It logs wire.ndjson beside itself, no credentials or actual tools.
- validation.json: bounded observed facts. backgroundChildrenActuallyTested:false is intentional.

Reproduce UI: launch pinned official T3 with fresh --base-dir, --no-browser, --host 127.0.0.1 and own port/project. Use copied public registry catalog, a clearly labeled acpRegistry entry with fixture executable override. Pair in browser. Submit WIRE_LONG_STEER_1; queue WIRE_CORRECTION_STEER_1; click rendered Steer. Submit WIRE_LONG_STOP_1; queue WIRE_QUEUE_RETAIN_1; click Stop generation. Do not use real agents/credentials. Fixture holds only WIRE_LONG prompts and cancels honestly.

Machine/research paths and bearer omitted. Fixture registry ID was gemini; generic source has no pi-acp-specific steering exception. Parent setup reused read-only. Initial browser harness “Send message” selector was wrong; corrected to “Submit message” before wire experiment, not a product failure.

Owned browser completed; server stopped; fixture exited; port closed. Private isolated auth/database/browser state removed. No production edits or release.
