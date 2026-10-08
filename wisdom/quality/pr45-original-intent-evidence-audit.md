# PR45 quality-intent evidence audit

Target: `0d8066e49868c82eb793a1248d055fd52a62037c`. Accepted continuation: `a0d9ef19504be165384f893c5bfda48dc7c08abb`; PR base/upstream: `22ad5f50acfc7b6ceed6483358022a0161a77d99`.

Actual model **openai-codex/gpt-6.1-sol**, verified in this session's model_change event (2026-10-08T14:59:57.365Z; session 01a11c07-203c-7617-b4fd-9a5fd5b50033). Durable inventory: [quality-intent-gaps.json](quality-intent-gaps.json), with exact final/prior Git blobs, task IDs, retained product paths and follow-up ownership.

## Verdict

**ACCEPT reuse of unchanged readability evidence. REJECT a claim of complete final-tip quality coverage. Final quality of the 36 changed/new product paths below is UNVERIFIED by the existing evidence.** This is an evidence-gap verdict, not a finding that those 36 files are bad. Current sibling journey judges may close these gaps; this audit does not substitute for their actual-code decisions.

- Coverage contains **835 accepted files, two accepted deletions, two pending tests** (839 rows). Of the accepted files, **788 still match**, including **385 maintained non-test product/configuration/shipped-prompt inputs**; **47 changed**, of which **27 are product/configuration** and 20 tests.
- Nine additional maintained non-test code paths have **no coverage row**. All nine are present at, and byte-identical to, upstream22ad5f50. They are explained upstream additions, not unexplained lost assignments. No other unexplained new maintained product path was found using the original inclusion/exclusion rules.
- The 55 final-diff lanes cover 516 distinct paths: **459 accepted lane paths still match**, **43 lane paths changed**, and 14 unchanged paths belong to the two rejected lanes. The 53/55 verdicts remain historical evidence, not exact-tip acceptance. Ledger candidate/scopedBlobComparison targets are older commits, not this target; auxStatus/resumeCheckpoint are saved bookkeeping, not current job/gate proof.

Hash equality retains file-byte judgments, **not automatic acceptance of a changed caller or composed journey**. The sibling changed-scope reviews must still examine composition through unchanged helpers.

## Is the older evidence actually about readability?

Yes, in the inspected artifacts—not merely counts/green CI:

- History disk-store primary93e226ba / judge0426dce8: one descriptor owns append/publication/rollback; indexes advance after success. Actual final append at `src/history/disk-entry-store.ts:761–801` still exposes that operation, but newly changed metadata/publication bytes invalidate reuse of its old whole-file blob.
- Task-manager judge08e2c508 **REJECTED**, then a01fd3d7 accepted explicit fresh admission versus reserved activation and the public projection. Final spot-read `src/tasks/task-manager.ts:204–225,280–303,795–832` shows these distinct operations and explicit allowlist. Its accepted blob still matches.
- Remote-owner judgment: journal descriptor/sequence/replay/write/fsync belong to one resource operation; existing answer/child boundaries need no churn. Final `src/remote/owner.ts:858–919` keeps timer stop, child release, persistence drain and journal close before terminal publication. Its accepted blob still matches.
- Live/session judgeaba16011 evaluated dispatch ownership and revocable checkpoints; compat/runtime judge9a477342 evaluated the shared history lifetime versus cross-closure state. UI/task-rows judge24064ab2 evaluated one lifecycle selection and one publication; CI-script judge23554482 accepted a direct lifetime/gate sequence unchanged. The latter three modified files cannot inherit their old final-byte verdicts.
- Site ignore judge2a36b538 explains operational exclusions, not rename counts. Lane38 explicitly evaluates the owned observation closure; lane49 evaluates semantic rendering decomposition, observer lifetime and return state. These are genuine structural judgments, scoped to their recorded bytes.

In contrast, the actual integration report `task_818b4420/pr45-integration-judge-sol.md` is framed around merge regressions and branch/session fences; the pagination recheck `task_39b0b6a3/pr45-pagination-fix-judge-sol.md` closes one correctness defect. `pr45-linux-repair-judgment.md` asks whether regression/assertion weakening warrants rejection. These useful reviews **do not provide a new intrinsic-readability verdict for the changed integration bytes**. Tooling additions are not enumerated in that integration judge's inspected product scope at all.

## Bounded product gap inventory

### Modified previously reviewed paths (27)

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `scripts/ci.sh`
- `scripts/pi-host-adaptation.ts`
- `src/agent/cache-countdown.ts`
- `src/agent/extension.ts`
- `src/agent/instruction-mode.ts`
- `src/agent/manual-shake.ts`
- `src/agent/native-compaction.ts`
- `src/agent/native-fast-mode.ts`
- `src/claude-compat/binding.ts`
- `src/claude-compat/cli.ts`
- `src/claude-compat/history.ts`
- `src/claude-compat/runtime.ts`
- `src/claude-compat/task-binding.ts`
- `src/goals/extension.ts`
- `src/history/disk-entry-store.ts`
- `src/history/service.ts`
- `src/history/session-manager.ts`
- `src/questions/runtime.ts`
- `src/questions/service.ts`
- `src/remote/extension.ts`
- `src/ui/footer.ts`
- `src/ui/rolling-activity.ts`
- `src/ui/task-rows.ts`
- `t3.json`

### Upstream new paths without per-file coverage (9)

- `scripts/install-ci-linux-tools.sh`
- `scripts/resource-harness/capture.ts`
- `scripts/resource-harness/provenance.ts`
- `scripts/resource-harness/replay.ts`
- `scripts/resource-harness/run.ts`
- `scripts/resource-harness/supervisor.ts`
- `scripts/resource-harness/workload.ts`
- `src/claude-compat/message-usage.ts`
- `src/claude-compat/task-child-journal.ts`

**Repair direction:** feed these exact blobs to the already-running history/session, nativeFast/agent/UI and compat/questions/remote/tooling journey judges. Preserve prior primary work and unchanged judgments; judge decisions, authority, lifetimes and navigation at final bytes. Explicitly record primary ownership for the nine upstream additions. Do not launch another 839-file sweep or prescribe changes if the actual code is clear. The JSON divides the 36 paths into those three follow-up scopes (3/10/23).

## Original scope / guidance provenance

The initial assignment ledger has **766 paths, each assigned once**, matching the expanded 748-path seed plus 18 maintained inputs. Coordinator ownership was not an edit wall. The primary/judge briefs explicitly permit coherent cross-file work and require actual-code independent judgment; inspected primary/judge IDs are distinct, with no accepted-row primary ID equal to its judge ID.

However, unique assignment is not proof of one single-focus worker per file: the later ledger reuses **70 primary IDs across 202 rows**. All but three paths are tests. The three script exceptions share primary7b708818: `scripts/loopback-parent-fixture.ts`, `scripts/remote-capability-pty-e2e.ts`, `scripts/remote-e2e.ts`. Their recorded per-file full-reading reasons and independent judgments are genuine and their hashes survive; **do not discard the quality evidence**, but disclose this batching exception rather than claiming a perfectly distinct one-file-worker process. Historical pendingReason fields sometimes survive on accepted rows; status, exact blob and concrete completed evidence—not that leftover string—determine the audit classification.

Guidance provenance is verified **internally**: values §2 and structural guidance link to the pilot's rejected naming pass and independent structural ACCEPT rounds, with coherent answer/settlement/cancellation journeys. The briefs carry that bar forward. **External readability-research provenance is unverified** in the inspected artifacts: no bibliography/source-to-guidance trail was located in these PR45 guidance/area notes. resumeResearch entries explicitly mean exact-blob reconciliation, not new research or judgment. This is a provenance limitation, not a reason to invent new rules or delay product repair with another broad research campaign.

## Deferred findings are test-only

Both rejected lanes' assigned blobs remain unchanged at this tip. Lane25 concerns real shell/RPC/print/JSON scenarios in `tests/subagent-extension.test.ts:147–173,218–282,722–775` without the owned process boundary. Lane55 concerns the test bootstrap `tests/worktree-workspace.test.ts:13–18` selecting login sh for setup cases. Production shell code appears as context, **not a demanded product-semantics change**. Keep the recorded fixture-only repair directions and unsafe/unrun limits; these are separate from the 36 product quality gaps. The two pending per-file rows are subagent-extension/worktree-workspace tests. Do not relabel the other 12 lane-assigned test paths as independently rejected product files.

## Exact read scope / limits

Read values, structural guidance, owner pilot, original repo-wide scope/process note and focused agent primary/judge briefs; coverage/assignments/jobs/integration-batches/final-diff-lanes JSON; all eight area ledger schemas and representative records named above; focused integration/handoff/Linux-repair notes and the two durable changed-scope judge reports. Compared every recorded accepted source hash and every lane sourceBlobs hash against the exact target tree, reconciled new maintained paths with the original exclusions and upstream tree, and checked the continuation/base diffs. Read representative actual final source portions of task-manager, disk-entry-store and remote-owner as cited; **not every source file or every judge narrative**. External citations/provider/runtime behavior and broad final code quality remain unverified here.

Only these two report files authored. No source edits, tests, installation, preparation, setup retry/bypass, cleanup/deletion, auth/device/recovery work or push. Wisdom/values unchanged: existing actual-code-proof and product-first guidance suffices. Parent owns combination and repair.
