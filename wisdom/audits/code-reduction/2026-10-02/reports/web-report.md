# Web maintenance-reduction audit (partial)

## Overview

READ-ONLY research: production, tests, config and wisdom were not changed. **32/33 assigned files read completely; 6,486/14,797 assigned lines reviewed.** The canonical patch is **not fully audited**: read 1–187 of 8,498; next unread **188**. This is not an every-line completion claim. Counts exclude the artificial trailing element produced by splitting a newline-terminated file.

Best opportunity: launch identity maintains a writable/fsynced sidecar despite deriving deterministic identities. Smaller opportunities: repeated acceptance-fixture primitives and genuinely redundant branches. No evidence supports wholesale deletion of the web runtime, schema trust boundaries or browser acceptance scenarios.

Estimates count assigned files only, exclude docs/wisdom, and do not overlap. Gross counts old lines replaced/deleted; net subtracts replacements. Behavior-preserving candidates total approximately **175–258 net lines**, with a separate optional diagnostic cut of **125**. These are proposals, not implemented or tested outcomes.

## Ranked actionable findings

### web-01 — Stop rewriting deterministic launch bookkeeping

**Class:** behavior-preserving refactor with an essential existing-identity boundary. **Confidence:** high for current-format new launches; medium for eliminating reads across existing state. **Gross:** 85–110; **net:** 65–90, retaining a small bounded existing-mapping reader. Pure derivation without any sidecar reads could instead save 110–130 net: an alternative, not additive.

**Evidence:** src/t3/tasks/launch-identity.ts:122–139 computes bruv-v1:hash(fingerprint). Eviction (129–131) and ACK (142–150) do not change the next derived ID. The file stores only fingerprint/ID pairs (10–11), not task results or launch status. Per-path serialization (12–13,64–79), the fsynced atomic writer (96–120), and row retirement are redundant for newly derived identities. Comments 129–134 explicitly say identity survives eviction and ACK.

Production callers already require durable execute invocation/call identity: src/tasks/job-service.ts:398–415 hashes invocation/call/batch index; SSH adds session scope at 488–502. Keep the durable session guard (267–271). ACK setup (274–300) exists only to remove these rows; its outside-set savings are not counted. tests/t3/native-routing.test.ts:260–310 already requires same identity after reopening, ACK and eviction.

**Counterevidence / boundary:** reserve returns a stored ID before deriving one (127–128). Read-only history inspection of 9abdc41:src/tasks/t3-launch-identity.ts found the same algorithm with a **die-v1:** prefix. Recomputing that pending ID as bruv-v1 can name a different backend child. Preserve a bounded read-only reader for existing mappings, or establish that no legacy pending execute intent can be retried before choosing pure derivation. Do not silently discard replay identity. No new compatibility framework needed.

**Behavior lost:** redundant sidecar creation/write/cleanup and associated write failures; test-only serializer cardinality API (46–49), not child replay identity. **Checks:** native and SSH same-intent replay, batch-index separation, changed-target same intent, post-ACK crash replay, and pre-existing die-v1 mapping. Keep parent scope guards and backend idempotence. Replace filesystem-bookkeeping assertions with identity assertions, not fewer crash/restart scenarios.

### web-02 — Share one small deterministic OpenAI SSE encoder

**Class:** behavior-preserving refactor. **Confidence:** high. **Gross:** 75–105; **net:** 40–65.

Same two-chunk + DONE encoding occurs in integrations/t3/gates/browser-acceptance.ts:115–140, preservation-acceptance.ts:63–83, worktree-acceptance.ts:133–158, rpc-smoke.ts:32–53, and integrations/t3/upstream/browser-route-reload.probe.ts:280–290. Three also duplicate execute tool-call construction. Share an encoder/tool delta builder, retaining each fixture's model router and timing.

**Counterevidence:** RPC returns Web Response, others write Node ServerResponse. IDs/model names/timestamps differ; some Node fixtures set no-store. Parameterize only those values and keep small response adapters, not a fixture server framework. Route probe delta selection (261–279) stays local. **Behavior lost:** none. **Checks:** compare parsed SSE frames for text/tool calls, headers, IDs and finish reasons; rerun the five isolated fixture gates against a reviewed executable. PTY, native stop, worktree and RPC scenarios are different coverage, not deletable duplicates.

### web-03 — Share exact-owned Linux process identity/tree/teardown primitives

**Class:** behavior-preserving refactor. **Confidence:** medium-high. **Gross:** 90–114; **net:** 35–55.

integrations/t3/gates/browser-acceptance.ts:183–244 and worktree-acceptance.ts:159–210 independently parse /proc stat after the final closing parenthesis, retain start-time identity, traverse children, assert exit and TERM/KILL an owned detached group. One stat parser/tree walker and configurable grace period reduce repeated ownership code.

**Counterevidence:** browser uses five seconds versus worktree's six; browser-root discovery, retained lists and proof formats differ. Preserve these locally. Do not expand to arbitrary PIDs/name scans/every harness. PID/start-time identity alone is not permission to kill. **Behavior lost:** none. **Checks:** stubborn leader, early-exiting leader with surviving descendant, normal exit, exact-owned isolation and PID reuse handling; then browser/worktree gates. Negative-group signalling must remain restricted to groups actually launched detached by that harness. These ranges do not overlap web-02.

### web-04 — Table-drive the loopback-enable auth test, retaining every negative

**Class:** behavior-preserving test refactor. **Confidence:** high for this reviewed section only. **Gross:** 44–50; **net:** 25–35.

integrations/t3/upstream/bruv.patch:15–65 repeats six whole config objects/expectation blocks. A default loopback config and named table for requested=false, desktop, wildcard host, absent host and Tailscale enabled retain all cases and the positive.

**Counterevidence:** these negatives guard a powerful unauthenticated principal (134–145,174–179), not speculative edge cases. Preserve distinct failure names. HTTP/WS origin tests (67–106) are separate and stay. **Behavior lost:** none. **Checks:** actual patched BruvWebAuth suite, packaged HTTP/WS gate, canonical regeneration/source consistency. Savings count patched test source/patch once, not both.

### web-05 — Delete demonstrably dead/redundant branches

**Class:** safe removal. **Confidence:** high. **Gross/net:** about 10–13.

- src/t3/tasks/mcp-client.ts:2,494–496: randomUUID is used only by exported newT3RequestId. Repository searches across src/scripts/tests/integrations and the canonical patch found no caller; production launch identity uses deterministic hashing. Internal source helper, not a package export or CLI entrypoint. Delete helper/import (~5 lines).
- mcp-client.ts:17,426: RETRYABLE_TOOLS aliases ALLOWED_TOOLS; 406 already rejects disallowed names. Remove alias/redundant membership clause, not 404 reconnect/replay. assertOpen at 439 duplicates 430 with only synchronous validation intervening.
- src/t3/tasks/local-notifications.ts:92–100: any prior completion returns at 93 regardless of input kind. retained therefore cannot contain that completion at 99 and 100 is unreachable. Remove 99–100 and simplify 96–98 to retain only other-task rows. Keep completion superseding attention and stable notification IDs.
- integrations/t3/gates/browser-acceptance.ts:21: stat import is never called; 185 merely names a /proc path/statLine. Remove import item.

**Counterevidence:** repository searches cannot rule out unpublished external consumers of internal exports, but none is evidenced. Other allowlist/URL/timeout/ACK guards remain. **Behavior lost:** none for repository callers. **Checks:** focused production-bridge, native-routing and local-notification completion-over-attention/idempotence tests plus typecheck; no paid provider required.

## Feature cuts requiring human choice

### web-06 — Retire the manual 1,010-launch Linux diagnostic

**Class:** optional diagnostic feature cut, not proven unused/dead code. **Confidence:** high on duplicate signal scenarios; medium on whether resource sampling is still wanted. **Gross/net:** 125.

integrations/t3/gates/launcher-runtime.ts:1–125 is a manual fake-backend lifecycle/RSS/fd/listener diagnostic. Lines 30–55 sample after 10 + 1,000 launches; 76–117 print signal/orphan observations and unconditional ok:true without regression assertions on measurements. Asserting equivalents for stubborn and early-exiting leaders exist at tests/t3/web-launcher-process.test.ts:78–145, including exact exit status and reaped descendants. No automated caller found in scripts/workflows, **but** integrations/t3/gates/README.md:16 documents manual invocation. No import is not deletion evidence.

Remove only if repeat-launch telemetry is no longer useful. **Behavior lost:** manual soak/metric output, not signal tests. If metrics are required, retain the file or move a small bounded invariant into an asserting test—do not call always-ok output equivalent coverage. **Checks:** existing process tests against built binary; if retaining resource coverage, establish baseline/assertions before retiring this file. No docs savings counted.

## Per-file verdicts

| Assigned path | Verdict |
|---|---|
| integrations/t3/build/build.ts | Keep canonical build/provenance, emitted graph and portable dependency checks. |
| integrations/t3/build/regenerate-patch.ts | Keep disposable-index patch exporter and developer CLI. |
| integrations/t3/build/verify-source.ts | Keep exact canonical source verification and untracked-source rejection. |
| integrations/t3/fixtures/native-task-contract.json | Keep explicit cross-schema fixture; no coverage-equivalent deletion identified. |
| integrations/t3/gates/browser-acceptance.ts | Keep native child completion/stop/reload; share narrow primitives. web-02, web-03, web-05 |
| integrations/t3/gates/contract-conformance.ts | Keep root Zod versus actual backend Effect schema conformance. |
| integrations/t3/gates/launcher-runtime.ts | Optional retirement of manual Linux resource diagnostic, not proven dead. web-06 |
| integrations/t3/gates/migration-acceptance.ts | Keep shipped production upgrade/restart and historical patch anchor. |
| integrations/t3/gates/migration-dependencies.ts | Keep exact dependency metadata and installed runtime closure checks. |
| integrations/t3/gates/native-acceptance.ts | Keep actual native integration evidence/isolation launcher. |
| integrations/t3/gates/packaged-smoke.ts | Keep relocated executable, unusable PATH, settings/auth and owned-PID checks. |
| integrations/t3/gates/preservation-acceptance.ts | Keep real PTY, local shell completion/user race and handoff/history; share SSE primitive. web-02 |
| integrations/t3/gates/release-browser-boot.ts | Keep release-workflow black-box cold mount/reload gate. |
| integrations/t3/gates/rpc-smoke.ts | Keep compiled RPC/local shell/subagent lifecycle and manual --serve entry; share SSE encoding. web-02 |
| integrations/t3/gates/startup.browser.test.mjs | Keep two cold contexts and reload regression; not equivalent to one setup paint. |
| integrations/t3/gates/worktree-acceptance.ts | Keep native/local worktree setup ownership and failure/cancel/background/missing action cases; share primitives. web-02, web-03 |
| integrations/t3/upstream/bootstrap.mjs | Keep preload clearing interpreter mode before RPC/terminal children. |
| integrations/t3/upstream/browser-route-reload.probe.ts | Keep exact conversation/model/mode/history across real process restart; share SSE encoding. web-02 |
| integrations/t3/upstream/bruv.patch | PARTIAL: read only 1-187; next unread 188. Keep reviewed auth implementation; table-drive test. No whole-patch verdict. web-04 |
| integrations/t3/upstream/chunks-large-data.test.mjs | Keep emitted WASM/grammar/HEIC lazy asset checks; no proven dead entrypoint. |
| integrations/t3/upstream/chunks-startup.test.mjs | Keep emitted static dependency cycle test invoked by build. |
| integrations/t3/upstream/chunks.test.mjs | Keep separate lazy-boundary and measured size assertions. |
| integrations/t3/upstream/heic.browser.test.mjs | Keep real decoding concurrency/error recovery and highlighted grammar checks. |
| integrations/t3/upstream/source.json | Keep source/build pin. |
| src/t3/tasks/events.ts | Keep opt-in bounded RPC NDJSON task lifecycle transport. |
| src/t3/tasks/launch-identity.ts | Replace writable deterministic bookkeeping with derived identity; preserve existing legacy mappings. web-01 |
| src/t3/tasks/local-notifications.ts | Keep crash-safe delivery/capacity/ACK; remove unreachable completion branch. web-05 |
| src/t3/tasks/mcp-client.ts | Keep bounded authenticated session transport; remove dead UUID helper/redundant checks. web-05 |
| src/t3/tasks/native-task.ts | Keep strict wire schemas/adapter and stable-key lost-response replay. |
| src/t3/web/archive.ts | Keep deterministic packaging, containment, private permissions and atomic extraction completion. |
| src/t3/web/embedded.ts | Keep dynamic shipped archive extraction glue. |
| src/t3/web/file-imports.d.ts | Keep compile-time Bun file import declaration. |
| src/t3/web/launcher.ts | Keep first-run defaults/settings preservation, dynamic embedded load and owned backend shutdown. |

## Keep rationale / actual use evidence

Build scripts are used by package.json build:web, scripts/build.ts:6,33–36, scripts/ci-web.ts:5,170 and tests/t3/web-source.test.ts:7. Regenerate also has its own import.meta.main CLI. embedded.ts is dynamically imported at launcher.ts:178. Preload and declaration are packaging inputs. .github/workflows/release.yml:305 calls release-browser-boot. Other gates include explicit manual environment/command entrypoints; absence of package.json commands does not establish non-use.

Lazy-boundary tests, emitted cycle detection and real WASM decoding have different jobs. Route probe actually restarts the backend (502–508) and retains model/mode/history; browser-acceptance covers native completion/stop/reload. Preservation drives real PTY and local jobs; worktree acceptance verifies native/local preparation ownership, failure retention and dirty-parent exclusion. Do not reduce tests by dropping these scenarios. Contract conformance deliberately tests two independently implemented schema systems; the root schema is a trust boundary, not duplicate syntax.

## Essential security/data-loss boundaries

- verify-source.ts:16–31: disposable index, exact HEAD+patch source, untracked rejection. Reverse-apply alone is insufficient. regenerate-patch.ts:16–29 leaves the real index untouched. Prepared verification runs before receipt invalidation (build.ts:104–110).
- archive.ts:11–20,65–75,87–115: path/symlink containment, private permissions, incomplete-extraction rejection and atomic completion publish. Dependency symlinks/concurrent extractors are real packaging requirements; no archive replacement savings asserted without examining runtime constraints.
- launcher.ts:28–32,49–78: reject corrupt/non-object settings, preserve unrelated existing settings, atomic private write. 105–163 owns only detached backend groups. External override and interpreter self-exec share essential cleanup. Bootstrap clears BUN_BE_BUN before RPC/terminal children.
- mcp-client.ts:44–61,218–233,256–280: reject partial credentials/unsafe URLs, never redirect bearer tokens, bounded body/timeouts, distinguish ambiguous commit from caller cancellation. Shared initialize/reconnect/close prevents aborting others and leaking sessions. Keep native-task.ts:93–118 backend error sanitation and strict versioned schemas.
- local-notifications.ts:82–87,124–149,215–262: capacity reserved before spawn, crash-safe completion persistence, retry without starvation, removal only after matching committed/disposed ACK. Unlike web-01, this mailbox contains irreplaceable undelivered text: deleting it loses work.
- Reviewed patch auth (122–179) must retain exact loopback bind, Origin, fetch-site and Tailscale gates; full administrative scopes make them essential.

## Gaps / checks not run

**Unfinished:** integrations/t3/upstream/bruv.patch, read **1–187**, resume **188–8498**. Remaining backend/native lifecycle, terminal, frontend routing, contracts and dependency sections were only located by reference/header searches—not line-reviewed. No removal/keep verdict is claimed for them. The patch dominates assigned lines, so this report must not be presented as the requested exhaustive audit.

All other assigned files were read in complete sequential chunks; missing beginnings in truncated previews were separately reread. Reference/caller/test/history reads outside the set are not exhaustive coverage of those files. No full build, suite, paid/provider/live server was launched. Estimates and proposed coverage preservation need implementation-time focused checks. Context: wisdom/values.md and relevant preservation security notes; no wisdom/docs cleanup proposed.
