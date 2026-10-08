# Quality-intent review: four tooling/configuration gaps

## Verdict: ACCEPT — all four assigned files

Independent actual-code readability judgment, not a rename, test or green-CI proxy. This closes these four quality-evidence gaps. No required product repair was found in the assigned files; it does not close unrelated PR45/runtime-safety gaps.

Product: 0d8066e49868c82eb793a1248d055fd52a62037c. Checkout/follow-up: 484dc0ef7a377518ce5a6bfd4b191c1c295cd0de. All four checkout blobs match the product target and auditor records. Comparisons: accepted continuation a0d9ef19504be165384f893c5bfda48dc7c08abb and upstream 22ad5f50acfc7b6ceed6483358022a0161a77d99.

Actual model verified from this session's assistant response, message 036f483d: provider openai-codex, model gpt-6.1-sol, API openai-codex-responses. Initial model_change agrees; this is not merely the requested profile. Evidence session: /home/tnfssc/.bruv/agent/native-sessions/2026-10-08T15-13-35-031Z_01a11c13-b137-7617-b4fd-9a777a388fd6.jsonl.

| Assigned path | Final Git blob | Verdict |
| --- | --- | --- |
| .github/workflows/ci.yml | 7a313b42ad0254b4b8b7757486a7d328116f902b | ACCEPT |
| .github/workflows/release.yml | c09f64d7c6eff219e858dc635ce649e948973ff8 | ACCEPT |
| package.json | 36c4bc198945cd56cc9f666c134213c802010fce | ACCEPT |
| t3.json | 35dcaf8840307cc434b40cf2dc613f56a3fb66d2 | ACCEPT |

## Concrete judgments

### CI: comprehensible admission and execution ownership

The whole workflow exposes comparison selection (37–65), docs/full planning and docs-only execution (66–85), two conditional platform jobs, and the required result gate (245–275). That gate directly requires planning success and admits exactly full:true:success:success or docs:false:skipped:skipped. Readers need not infer success from skipped jobs or reconstruct nested partial checks. Compared with upstream this is a substantive simplification of result admission and its diagnostics, retaining the accepted continuation's gate structure.

Following the planner confirms that unknown/non-reference changes require full validation and its docs command cannot silently replace full CI. PR topology checks and trusted-push baseline lookup establish different comparison authorities, not duplicate versions of one choice. The workflow invokes package ci/ci:macos aliases, whose shared script owns the ordinary validation sequence and exit propagation. Platform-native compiler/Pulse checks remain visible additions rather than a hidden competing generic gate.

Since a0d9ef19, one install-ci-linux-tools.sh --native-audio call replaces separate PTY/audio/native apt blocks. The installer actually selects that native package group. CI/release share installation ownership; the workflows visibly own download caches. The cache namespace change adds no decision layer. The lengthy Pulse block has a coherent fixture lifecycle: allocation, exact dependency, private null sinks, readiness, protocol check, teardown. Length alone is not a rejection reason.

### Release: one admitted source and one publication authority

The full workflow separates manual preparation, admitted source, native-helper production, packaging, final-platform checks and publication. release-source (52–73) owns manual-versus-stable-tag eligibility and pins SHA/tag once. Every downstream checkout consumes that SHA. Compared with upstream, downstream repeated event predicates and repeated SHA/tag fallback expressions disappear. This is meaningful ownership improvement already present at a0d9ef19, retained in final bytes.

release-source is not a cosmetic pass-through: it owns eligibility and common identity. Downstream success checks gate dependencies rather than competing to select source. Helper/staged-asset names expose handoffs. Publish (326–353) explicitly requires packaging and both final-platform gates. Reading its commands confirms the boundary: preparation owns next version/notes, validation checks package/tag identity, publication owns remote-tag agreement, immutable complete asset identity, draft completion and public readback. The final installer change reuses the Linux tooling owner without moving release policy into it.

Repeated native checks, caches and bootstrap steps operate in separate jobs/platform contexts; they are not divergent release-admission algorithms. No new gate framework or registry is justified.

### Package: direct command map, not duplicate orchestration

The full manifest maps commands directly to their entrypoints. ci/ci:macos select one script's lanes; build reaches the paired-build owner. Pair/connector reading confirms one compiled normal executable plus a connector launcher, not independently compiled duplicate runtimes. check visibly prepares assets before typechecking; test visibly builds before root tests. CI calls build then the test runner directly, avoiding an extra build through the test alias.

Only version and perf:resources changed since the prior accepted manifest. The new alias points directly to resource-harness/run.ts; its CI caller supplies profile/output location. That runner exposes write/resume phases, retained reports and process exit outcome. The alias hides no separate scheduling/gating mechanism. Final package bytes equal upstream. This accepts manifest/entrypoint composition, not another task's workload implementation.

### T3: explicit setup command dependencies

The only changed command replaces a trust semicolon/ambient Bun lookup with mise trust ... && mise exec -- bun install --frozen-lockfile && mise exec -- bun run prepare:assets. Trust, locked install and asset preparation are in visible dependency order; failures prevent later shell-command stages. mise.toml directly supplies pinned tool versions. Other actions reach the same package CI/build/performance owners rather than copying those sequences. Final t3 bytes equal upstream.

Caller inspection is material: readWorktreeSetup selects the flagged action and defaults omitted async to true. JobService records a separate setup task and eventual outcome. The fail-stop shell chain therefore does not promise that native child launch waits for setup completion. This unchanged asynchronous contract is not a newly introduced blocking gate. Acceptance covers configuration and actual caller semantics, not setup success or a revised lifecycle promise. It grants no permission to retry/relax Pi preparation.

## Adjacent discrepancy; concrete direction

scripts/ci.sh:2 says workflows own tools/log upload “only,” but the workflows also directly own native sanitizer/protocol checks. Those checks are plain in the assigned code, so this companion comment does not overturn the four verdicts. If touched, change the comment to distinguish the shared ordinary gate from workflow-owned platform-native checks. Do not relocate checks just to make that comment true. No required repair to the four assigned files.

## Exact read scope and limitations

- Full current assigned files: CI 1–275, release 1–353, package 1–58, t3 1–33. Complete four-file diffs from a0d9ef19 to product and from upstream22ad5f50 to product. Git blob identities checked at all four refs. Current full-file reading plus complete deltas supplies the comparison; no separate full historical-file reread claimed.
- Full command owners: scripts/ci.sh, install-ci-linux-tools.sh, ci-selective.ts, find-ci-baseline.ts, build-pair.ts, build-claude-compat.ts, prepare-assets.ts, prepare-manual-release.ts, validate-release-tag.ts, publish-release.ts, resource-harness/run.ts; full mise.toml.
- Caller excerpts only: src/tasks/worktree-workspace.ts 63–114 and 194–198; src/tasks/job-service.ts 1010–1052 and 1090–1144. No whole-file verdict for either.
- Intent: the four selected records and metadata of the auditor's quality-intent-gaps.json; full wisdom/values.md, structural-readability-guidance.md, structural-readability-owner-pilot.md (original pilot), pr45-original-intent-followup.md. Tooling-area handoff opening/structural outcomes and mise setup rationale were supplementary context, not acceptance authority.
- Not reviewed in depth: native C/C++/Python implementations, browser/native release harness internals, updater/verifier internals, Pi adaptation internals, terminal labs, resource workload/supervisor/capture internals and history implementation. These bodies receive no fresh acceptance here. History/workload repairs remain other tasks' work; no overlapping edits.
- No workflows, install, setup retry, tests, release/deployment, auth/secrets, push or merge performed. No source/config changes; only this report was written. No setup-success, runtime-safety, platform-parity or whole-repository acceptance claim. Known strict Pi setup concerns were not retried or bypassed.

Values and guidance are unchanged: this applies their existing actual-code judgment requirement rather than inventing quotas, thresholds or machinery.
