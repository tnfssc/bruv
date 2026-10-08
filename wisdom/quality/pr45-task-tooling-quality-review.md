# PR45 independent quality-intent judgment

Target: `0d8066e49868c82eb793a1248d055fd52a62037c`; integration comparison: `a0d9ef19504be165384f893c5bfda48dc7c08abb..0d8066e4`; PR base: `22ad5f50acfc7b6ceed6483358022a0161a77d99`.

Actual model verified from this worker native-session `model_change` record (2026-10-08T15:00:48.207Z): **openai-codex/gpt-6.1-sol**. Worktree: `/home/tnfssc/.bruv/worktrees/t3-1dc1185b-5442693331ce-task_69099508`.

## Verdict

**REJECT the assigned scope only for the small tooling ownership gap below. ACCEPT its changed product-source scope.** This is actual-code readability/ownership judgment, not regression-only approval or a CI verdict. Do not block unrelated product progress on a new test-polish campaign.

### Concrete repair

`scripts/resource-harness/workload.ts:257–273` reproduces the child-history operation now owned by `src/claude-compat/task-child-journal.ts:56–77`. Both decide stream-event exclusion, child causal binding, append/replay, and the boolean that suppresses already-durable frames. Runtime delegates to that owner at `runtime.ts:417`, but the workload implementation saying “Match runtime.ts” must still be compared manually against it. They already differ: the production operation carries assistant cost; the copied workload operation does not.

This is tangible duplicated policy, not an independent reference model or a request for more assertions. **Replace the inline writer with `writeNativeChildFrame(native, source, frame)` and remove its obsolete import.** The text-only synthetic translator may remain; sharing `nativeAssistantUsage` at workload.ts:107–112 would also remove a second copy of that mapping. No new framework, guards, budgets, or test matrix is needed. Freshly judge those repaired bytes; green CI does not resolve this rejection.

## Accepted journeys and why

- **Storage → continuation:** `cli.ts:166–174` calls `nativeStorage` before runtime composition; `binding.ts:129–135` installs the disk reader before opening a journal. Import/checkpoint decisions remain together at binding.ts:159–205. History’s import map, queued replay validation, immutable cost handling, and child-writer identity cache are coherent operations (history.ts:110–313), not another scheduler. Metadata indexes replace retained payloads without claiming ownership of tasks.
- **Task restore → child replay → terminal → shutdown:** task-binding.ts:104–170 selects authoritative latest root/job cursors; its legacy reference has a real existing-history migration purpose. task-binding.ts:206–253 translates complete child rows and advances its offset; the journal reader owns the descriptor in one finally (task-child-journal.ts:10–53). Durable writing precedes frame exposure; observe’s ordering is visible at task-binding.ts:376–431. The task extension drains the real manager before closing the projection binding (agent/extension.ts:685–686), whose close drains its queue and saves dirty cursors. This preserves coherent launch/result helpers while making repeated history growth understandable.
- **Human authority:** questions/service.ts:78–96,174–224,313–335 selects IDs/causality without loading message bodies; the saved ledger still owns answers and mutations. questions/runtime.ts:191–239 rechecks that ownership before a new parent turn, not an old child resumption. remote/extension.ts:99–119 filters replay records before loading originals while keeping observation/publication lifetime local (76–234). Fast selection passes explicit consent from binding/CLI into the existing Fast owner, rather than duplicating billing authority in runtime (runtime.ts:616–625,688–702; native-fast-mode.ts:548–565).
- **Tooling lifetime/validation:** host adaptation validates all candidate files before writes and replaces copied inodes, avoiding shared-cache mutation (pi-host-adaptation.ts:233–270). Its separate settings/context/preview views correspond to actual disk-owner operations, not generic callback machinery. The harness runner, supervisor, and capture/replay separate invocation, owned-child limits/drain, private snapshot, and offline replay. Limits and failed-write skip decisions are explicit; the supervisor waits for close and sampling before publication (supervisor.ts:179–200). CI and installer changes are straightforward wiring, not another execution system.

## Exact read scope and limits

Final source read in full: `src/claude-compat/{history,message-usage,task-binding,task-child-journal}.ts`; all six `scripts/resource-harness/*.ts`; `scripts/ci.sh`, `scripts/install-ci-linux-tools.sh`.

Changed integration bytes plus journey context: `binding.ts:1–205`; `cli.ts:60–65,121–233`; `runtime.ts:1–90,140–210,226–473,536–793`; `questions/runtime.ts:1–10,139–258`; `questions/service.ts:1–15,66–101,106–157,169–245,297–338`; `remote/extension.ts:1–12,52–236`; `pi-host-adaptation.ts` integration additions/replacements and lines 233–271 (not a fresh judgment of its unchanged inherited patch literals). Before/after integration diffs were read for the modified product/host operations.

Adjacent owners inspected, not independently accepted in full: `history/session-manager.ts` metadata traversal/selection and settings/context/preview methods; `history/disk-entry-store.ts:589–611` task-key indexing; `tasks/task-owner.ts`; `agent/extension.ts` binding/startup/shutdown seams; `agent/native-fast-mode.ts` explicit host consent and shutdown.

Read values, structural-readability guidance, original owner pilot, focused integrated connector review, PR45 integration/product-failure notes, and relevant resource-fix/harness/startup notes. Older 53/55 verdicts remain evidence only for earlier bytes; the original pilot supplies the authority/lifetime criterion, not acceptance of this integration.

**Unverified:** unchanged portions outside the stated ranges, all other repository paths, live/rendered behavior, performance measurements and executable validation. No assigned changed path was skipped; this is not whole-repo acceptance. No scripts, tests, install or prepare were executed; no source edits or push. Only this report was written. Values unchanged: existing one-owner and truthful-evidence guidance already addresses the finding.
