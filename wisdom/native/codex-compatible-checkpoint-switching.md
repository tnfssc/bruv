# Codex checkpoint model switching (2026-10-01)

## Correction and evidence

A different model ID is **not** evidence that an opaque Codex compaction is provider-incompatible. The former original-model-only guard and prompt were die policy, not the upstream Codex contract. Astra → Sol needs normal switching, not force approval, reset, flattening, checkpoint deletion or provenance relabeling. This does not establish compatibility across arbitrary APIs/providers or every model configuration.

Verified official openai/codex checkout: SHA 8ea2428c38f8994e18d789669f5cbc5df75e1f17, path /home/tnfssc/.die/tmp-pi-removal/codex-source-probe-1790829586 (research task_e19afd27).

- codex-rs/models-manager/models.json: Astra gpt-6-astra lines 4–37 and Sol gpt-6.1-sol lines 178–210 both have comp_hash: "3000", context_window: 272000. Other Sol entries also have those values.
- codex-rs/protocol/src/openai_models.rs 462–464 defines the opaque compaction-compatible configuration hash.
- codex-rs/core/src/session/turn.rs 1328–1414 recompacts with the previous model only for **two known unequal hashes**; a missing hash does not trigger that path. 1417–1461 handles smaller-window switching when context exceeds the new limit. Neither trigger applies to this pair.
- codex-rs/core/src/compact_remote_v2.rs 447–460 preserves the exact Compaction output item.

## Implementation and limits

Pinned pi-ai / pi-coding-agent 0.99.1 Model/catalog and runtime model objects expose contextWindow but **no comp_hash**. Inspected the Model type, model-config/registry and getModels("openai-codex") object keys; no hash catalog is available to the adapter. Follow upstream missing-hash semantics rather than treating different IDs as unequal hashes. No hardcoded pair exception or catalog-fetch service.

The native adapter permits valid checkpoint replay within the stored API/provider boundary. Only the ephemeral assistant shim uses the **selected model ID**, because pi-ai dist/api/transform-messages.js 68–84 otherwise drops its empty signed thinking before the compaction converter sees it. Stored d.model remains origin provenance, and the original entry and ciphertext are unchanged. Ordinary encrypted reasoning is not relabeled. Malformed checkpoint, provider/API, exact serialized-item presence and in-flight exact model/generation checks remain.

**Not implemented:** upstream known-unequal-hash old-model recompaction (metadata is not available here), nor dedicated previous-model context-downshift handling. Existing SDK compaction/context-limit behavior is not evidence of full upstream parity. This change neither advertises universal model-family interchangeability nor synthesizes compatibility hashes. Those workflows need separate work if metadata/context downshifts become relevant.

## Durable work and verification

- Branch: die/allow-codex-compatible-model-switching-w-b1e4ae76
- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_b1e4ae76
- Parent base: 82cdcff; no task_042241cf reject/force changes integrated.
- Focused unit + real pinned SDK tests use offline transports only. A real SDK-produced opaque checkpoint switches Astra → Sol, sends the selected request model and original item exactly once, then reconstructs from disk and repeats; entry/model/ciphertext stay intact. Repeat native compaction, wrong provider/API, noncheckpoint switching, ordinary encrypted reasoning, missing/changed serialized item and stale in-flight model selection are covered. Existing payload/cancellation coverage retained.
- SDK fixture resets its offline transport seam before opening another session: reusing a disposed session's fast-mode-wrapped runtime produced a stale-ctx error and misleading old-payload assertions. Disk-resume assertions now require a **new** provider payload each time.
- Bun 1.4.2; TMPDIR=/home/tnfssc/.die/tmp-pi-removal. Focused tests and typecheck only; no full suite, paid/live probes, live-session edits, /shake changes, release or push.

Verification completed: 42 focused tests passed (252 assertions), including the real pinned SDK offline serializer. bun run check passed (tsc --noEmit). Logs: /home/tnfssc/.die/tmp-pi-removal/checkpoint-switch-focused.log and checkpoint-switch-typecheck.log. Bun executable: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun.
