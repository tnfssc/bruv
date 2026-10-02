# Code reduction audit

**Implementation is complete:** [actual changes and validation](implementation.md). The audit below records the original baseline, not current file contents. No product feature cuts were taken. The user later approved and completed [historical archive retirement](../../../wisdom/quality/t3-archive-retirement.md): 24 files, 35,011 lines.

**User constraint: keep important features. No feature cuts are approved. Preserve current behavior by default; feature-cut tables below are options for discussion only. Start with proved dead code and behavior-preserving simplification.**

**Complete: 689/689 files and 160,840/160,840 physical lines reviewed. No unread gaps.**

[Per-file coverage and verdicts](coverage.json) · [Detailed reviews](reports/README.md) · [Scope totals](scope.json) · [Parent verification notes](parent-checks.md)

Baseline: d80d7058a2f5481f067586fd7042fe2746cff4ae. This is an audit, not a deletion patch. No product features have been removed.

## Scope

689 tracked code/config files, 160,840 physical lines. Runtime, tests, native helpers, scripts, executable config, web patches and old experiments are included. Wisdom, prose, lockfile data, binary assets, dependencies and generated/untracked output are not deletion targets. Patch lines include context and removed upstream lines; they are not all current runtime source. Physical lines include blanks/comments. Two files have unterminated final lines, which are included in this total.

Every file has an owner and a coverage record. Large patches and unfinished first-pass test groups were split into smaller follow-ups. Original partial reports stay honest; the joined ledger supplies the final coverage. Reading every line does not prove a deletion safe. These are evidence-backed estimates, not measured diffs.

## What stands out

1. **Old T3 archives dominate raw size.** The historical production-v2 archive has 24 code/config files and 35,011 lines. Current build roots select integrations/t3, not that archive. Retiring in-tree historical replay is the largest no-current-product-change option. It removes archaeology/reproduction inputs, not 35,011 lines of active runtime logic. Preserve the baseline Git revision; never mistake the current canonical bruv.patch for an old patch.
2. **Some production code survives only because tests exercise the old implementation.** Examples: volatile LocalCapabilities, the timestamp transcript grouper, the captured-context compaction builder, and the web delegation-policy walk. Move useful assertions to the real production owner; remove only obsolete expectations.
3. **Small UI/diagnostic features carry substantial machinery.** Custom conversation density, the cache-TTL badge, Herdr integration and speaker diagnostics are the best product choices to discuss. None is dead code.
4. **Repeated harness plumbing is a better test target than fewer assertions.** SSH/Docker setup, tmux polling, SDK session setup and deterministic SSE fixtures repeat. Share narrow mechanics without combining different scenarios or weakening cleanup/privacy.

## First cleanup batch: no intended feature loss

| Change | Estimated net saving | Evidence |
|---|---:|---|
| Remove unused volatile capability implementation; keep the safe file reader and move unique store assertions | 124–126 source + 40–60 test lines | [remote-01](reports/remote-report.md) |
| Remove unused Live transcript grouper and only its tests | 101 total lines | [live-02](reports/live-report.md) |
| Retire old captured-context compaction builder and write-only snapshot fields | 60–75 source + 10–35 test lines | [core-01](reports/core-report.md) |
| Remove copied, uncalled PTY harness helpers/counters | 41 lines | [tooling-01](reports/tooling-report.md) |
| Remove no-op wisdom job notifications and command-only cached context; keep /wisdom and its guidance | 27–33 source + 3 test lines | [core-02](reports/core-report.md) |
| Remove unconsumed packed-web content-key wrapper and only redundant assertions | 15 total lines | [tooling-08](reports/tooling-report.md) |
| Remove write-only Live provider-model memories | 32–35 source lines | [live-03](reports/live-report.md) |
| Remove uncalled web self-exec scaffolding and only its tests; keep real launcher/bootstrap sanitation | 38 total lines | [wp3-01](reports/web-patch3-report.md) |

These separate scopes total roughly **491–562 net lines**, including the explicitly counted test edits. This is a planning range, not a measured patch. Implementation must still check current references and run the named focused tests. Exported internal helpers are not published APIs here, but external private embeddings cannot be ruled out by repository search alone.

## Larger behavior-preserving simplifications

| Change | Estimated net saving | Evidence / caveat |
|---|---:|---|
| One network-none Docker/SSH acceptance harness | 220–300 lines | [tooling-02](reports/tooling-report.md); retain exact-owned cleanup and scenario differences |
| Retire obsolete companion Live orchestration and migrate diagnostic fixtures | 225–290 lines | [live-01](reports/live-report.md); probes really use the old interface |
| Share intercepted Realtime study transport | 160–210 lines | [tooling-05](reports/tooling-report.md); alternative to retiring the study |
| Share loopback fake-provider/RPC client plumbing | 130–165 lines | [tooling-03](reports/tooling-report.md) |
| Share the two near-identical SSH transports | 72–78 source lines | [remote-02](reports/remote-report.md); keep host checks, bounds and cancellation |
| Stop writing deterministic launch-ID sidecars | 65–90 source lines | [web-01](reports/web-report.md); preserve existing pending identities |
| Replace hand-written JSONC parser with Bun.JSONC.parse | 60–70 lines | [execution-01](reports/execution-report.md); malformed unterminated comments become rejected |
| Share exact durable JSON replacement helpers | 35–48 source lines | [remote-05](reports/remote-report.md); immutable writes remain separate |
| Require the configured root question service | 30–35 source lines | [remote-03](reports/remote-report.md); remove fixture-only dispatch fallback |

Overlap notes: [web-04](reports/web-report.md) and [WP1-01](reports/web-patch1-report.md) are the same auth-test change. [WP1-07](reports/web-patch1-report.md) and [web-patch2-03](reports/web-patch2-report.md) are one delegation-policy consolidation. [core-01](reports/core-report.md) absorbs [F3-03](reports/tests3-followup3-report.md)'s obsolete compaction-helper test deletion. The old experiment patch reports all point to whole-artifact retirement, not separate additive deletions.

Do not add every report's totals: some test helper proposals share replacement costs, and feature cuts absorb smaller refactors. A shorter abstraction is only worthwhile if its callers stay simpler.

The detailed test reports also identify tiny duplicate assertions and narrow acceptance cuts. Those are **not** all recommendations to implement. Keep independent reference models and useful negative cases. Do not trade meaningful evidence for a handful of lines. Prefer removing an obsolete implementation, using an existing helper, or sharing a repeated lifecycle owner over inventing another fixture framework.

One extra maintained-web opportunity is to reuse the actual orchestrator delivery test setup rather than keep a second copy (~110–120 net lines; [web-patch2-01](reports/web-patch2-report.md)). Preserve its real workspace layer and all five local-job cases. This changes the canonical patch and selected gate path together; it is not deletion of acceptance coverage.

## Small-feature cuts worth considering

Source estimates below exclude feature tests unless stated. Each needs an explicit product decision.

| Feature to cut | Estimated source saving | What disappears |
|---|---:|---|
| Custom conversation density/thinking rendering | 529, or 593 with quiet-tool overrides | Bruv-specific spacing and condensed thinking; native rendering remains |
| Provider cache-TTL estimate badge | ~445–485 | /cache-ttl and countdown display, not caching/compaction |
| Herdr pane integration | 410–420 | External pane status/session links/quit release |
| Speaker-correlation diagnostic | 400–425 | /live speaker-check; voice and mic-check remain |
| Descendant-dollar aggregation | 300–325 | Recursive child-session cost total; label remaining cost root-only |
| Lifecycle diagnostic sidecar | 175 plus uncounted wiring | .jobs.jsonl forensic index, not task lifecycle/cancellation |
| Animated PCM footer | 75–95 | Waveform animation; lifecycle text stays |
| Automatic oversized-image resizing | 75–95 | >5 MB images must be resized explicitly; showImage remains |

Larger product cuts, not harmless cleanup: persistent autonomous goals (~750–775 owned source lines); legacy alternate /remote inbox/launch/answer workflow (~500–750 after replacement grant/reconciliation access); server-hosted root-agent placement (~2,550–2,580 assigned source lines). See detailed reports before choosing.

Developer-only retirement options: the completed September 25 instruction-study scripts (786 lines; alternative to sharing their transport), and the frozen old video renderer (124 lines; overlaps renderer sharing). Retiring all experiments is broader than retiring the frozen T3 archive: several remote labs are runnable and retain unique failure/security probes.

## What not to cut blindly

- Native FFI handle retention just because TypeScript says it is unused.
- Host-key verification, capability confinement, atomic writes, immutable launch identity and replay boundaries.
- Cancellation/process ownership, short-write handling, output bounds and hidden-message privacy.
- Real compiled/TUI/SSH/provider acceptance because unit tests look similar.
- Mixed test files wholesale when only one retired utility or assertion is obsolete.
- Production image WASM/bootstrap assets because they are loaded dynamically.

## Findings that need correctness care, not deletion

The maintained web patch allocates delegatedTaskMutationPermit but never uses it (bruv.patch:4693,4736–4739; target Orchestrator.ts). Comments describe a shared cancellation/descendant-creation boundary, while dispatch still uses per-thread locking. This is **not proof of an observed cancellation failure**, and deleting the allocation would not establish safety. Trace/test the actual cross-thread cancellation owner before deciding whether the unused semaphore is dead scaffolding or a missing connection. No savings are credited. See [web-patch2-05](reports/web-patch2-report.md).

Also, tests/live-extension.test.ts:658–659 checks the first fixture after exercising a second fixture. Parent confirmed the mismatch: those privacy/teardown assertions should inspect running, not t. Retarget them rather than deleting the apparent duplicate. This is a test-coverage defect, not evidence that raw errors currently leak. See tests1-followup1 F06.

## Checks and limits

Parent ran TypeScript with --noUnusedLocals --noUnusedParameters: 34 TS6133 diagnostics, no other diagnostic type. Exit 1 is expected for that stricter audit check, not proof the normal check fails. Most are tiny; unused initializers may have side effects. Parent independently checked key references and the SSH transport diff. Reviewers also ran bounded offline/syntax checks where recorded. No full build, release, paid-provider, audio-device or complete runtime gate was run for this read-only audit.

## Next step

Implement the first cleanup batch in a worktree, preserving meaningful assertions. Run focused checks and inspect the actual diff/net deletion. Then choose which small features and historical tools no longer deserve maintenance. Do not combine feature retirement with security/recovery refactors in one large patch.

## Coverage and handoff

The 32 detailed reviews cover 12 original areas plus bounded follow-ups. All original coverage gaps are closed in coverage.json. Each entry records the reviewed file hash, inclusive ranges, report links and verdicts. Original partial reports remain unchanged for honest provenance; their partial banners do not describe the final joined result.

All findings refer to the baseline revision above. No source/test/config edits were made, no features were removed, and no commit was created. The audit documents are new files. Implementation and focused regression checks remain next work.

Project wisdom: saved the audit handoff in wisdom/quality/code-reduction-audit-2026-10-02.md. Existing value 7 now calls out the repeated test-only obsolete-implementation pattern, with an explicit exception for useful independent reference models. Wisdom/prose was not audited as a deletion target.
