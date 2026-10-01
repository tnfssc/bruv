# Shake alongside an opaque native checkpoint

## Work / scope

Branch: die/make-shake-preserve-native-checkpoints-a-9565c84f
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_9565c84f
Base: 919e4a7 (released v0.15.15). No die binary install, publication, paid request, or live-session operation.

The release fixed compatible checkpoint model switching, but /shake still blanket-refused the branch. This change prunes only newly proven completed execution traces exposed in the active context. It never opens or rewrites ciphertext, checkpoint provenance, runtimeState, original messages, or old journal lines.

## SDK boundary (0.99.1)

Actual dist/core/session-manager.js buildContextEntries returns the latest compaction at index zero, its explicitly retained precheckpoint range, then entries after that checkpoint. Discarded prefix entries are absent. buildSessionProjection emits no messages for older compactions retained inside that range and applies context edits. These are the safe active-boundary semantics, not the whole branch/journal.

- Shake planning and exact-occurrence matching operate only within that boundary; discarded IDs/tool batches cannot poison it or accumulate in markers.
- Older retained checkpoints remain byte-identical in the journal but are not additional active replay items. nativeEntriesInContext and the adapter now follow the SDK's effective checkpoint boundary; request serialized-item validation itself remains in place.
- Preview starts from the SDK canonical projection, not raw entry flattening: context edits and excluded history are never restored.
- Newly persisted IDs must be actual unambiguous matches in transformed hook output. Existing active exclusions carry forward; IDs outside the active boundary do not.
- Signed thinking whose signature is a native compaction item is a protected transport shim, never ordinary reasoning. No crypto is involved: only the public item discriminator is inspected.
- A valid current checkpoint/API/provider is required before preview. After hooks, exactly one unchanged SDK summary OR unchanged native shim plus runtime-state message must remain. Missing/changed/duplicated representations refuse without saving a marker.
- A checkpoint with no newly eligible trace gives an honest no-op: native checkpoint remains unchanged.

## Evidence

Focused command: Bun 1.4.2 test tests/native-shake-sdk.test.ts tests/manual-shake.test.ts tests/native-compaction.test.ts tests/auto-shake-sdk.test.ts
Log: /home/tnfssc/.die/tmp-pi-removal/shake-native-focused.log
Typecheck: Bun node_modules/typescript/lib/tsc.js --noEmit
Log: /home/tnfssc/.die/tmp-pi-removal/shake-native-types-direct.log

Result: 79 focused tests passed, 0 failed, 454 assertions across four files. Typecheck passed.

Tooling caveat: attempted pnpm exec unexpectedly auto-installed dependencies through the worktree node_modules symlink into /home/tnfssc/Code/die/node_modules; its build-script approval gate refused, and typecheck instead used Bun directly. Original package directories were moved into node_modules/.ignored by pnpm; declared dependency versions remain usable (focused tests/typecheck passed). Generated worktree pnpm lock/workspace files were removed; no tracked parent files changed. Do not repeat this pnpm command against shared linked dependencies. Diagnostic log: /home/tnfssc/.die/tmp-pi-removal/shake-native-types.log.

The real SDK session executes /shake with the production task extension. A kept tool trace and a postcheckpoint mixed reasoning/prose/tool trace are pruned. The transport shim and runtime-state message compare exactly before/after; SDK response conversion and before_provider_request preparation contain the opaque item exactly once, byte-identical. User/assistant prose remains. No provider request occurs for /shake; ordinary follow-up uses a local stream stub. JSONL checkpoint line, original provenance, disk reopen, and repeated no-op are checked.

Additional tests prove transformed synthetic thinking cannot be selected/removed even with adversarial message provenance; excluded prefix unresolved/duplicate IDs do not affect current planning; excluded hook output IDs do not accumulate; context edits are honored; older retained checkpoint schemas do not become active payload requirements. Active invalid schema, wrong API/provider, unresolved batches, stale hooks, lost/duplicate shim and changed runtime-state still refuse. Existing model-switching/serialized-item/stale-capture and noncheckpoint tests remain in the focused run.

## Limits / policy

Automatic shake-before-compaction stays explicitly deferred while the effective checkpoint is native. It returns without preview, invalidation or cancellation, leaving native compaction and its existing capture/generation fences in charge. Noncheckpoint automatic shake uses the same exact-match marker narrowing. Conservative ambiguous/reordered/transformed tool batches stay whole. Bounded marker/storage failures still refuse. This is local pruning, not evidence of provider cost reduction, portable encryption, full Codex comp_hash transition support, or plaintext restoration.

Values unchanged: this applies existing authoritative-history, bounded-state, truthful-UI and leave-user-work-safe principles, rather than adding a new architectural rule.
