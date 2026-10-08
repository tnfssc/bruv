# PR45 original-intent follow-up

## Goal and outcome

The user asked for maximum whole-repo readability and removal of AI slop, not a rename sweep or a green-CI claim. Each primary agent gets a file focus, not a wall against coherent cross-file repairs. Research and pilots guide judgment. Independent GPT Sol judges read actual code. Later product-first direction makes test polish lower priority; it does not cancel this quality bar.

This follow-up corrects our earlier regression-only integration review. The existing source judgments contain actual readability reasoning. Their unchanged bytes are retained, not reviewed again for a count. An exact-hash audit found 27 modified reviewed product/config paths and nine explained upstream additions. Current journey judges read those changes and their composed owners. Reports state exact ranges; this is not a claim that each judge reread every unchanged line.

Three concrete rejection areas are repaired and independently accepted:

| Area | Reading burden removed | Integrated commit | Exact quality receipt |
| --- | --- | --- | --- |
| History | Unused competing context selector; append prepared the same metadata twice and described obsolete recovery | 91903cde | [history acceptance](pr45-history-quality-acceptance.md) |
| Fast | Host, command and inherited startup separately constructed/published consent checkpoints | ecbca439 | [Fast acceptance](pr45-fast-quality-acceptance.md) |
| Resource workload | A copy of production child-history policy already differed on assistant cost | be713e9e | [workload acceptance](pr45-workload-quality-acceptance.md) |

Each final repaired source/assertion blob matches its independent receipt. The accepted surrounding retrieval/memory, agent/UI, task/continuation and configuration journeys were retained. No generic framework or broad rename pass was added. Workload cost handling now follows its real production owner; inherited Fast persistence failure gets caller-specific reporting. These effects are explicit, not described as universally byte-identical behavior.

## Evidence and limits

- [Evidence audit](pr45-original-intent-evidence-audit.md) records older source matches, actual prior rejection/acceptance reasons and process exceptions.
- [Product gap reconciliation](pr45-product-quality-gaps.json) links all 36 changed/new product paths to final blobs and current reports. Its initial gap classification is historical; finalQuality records the resolution.
- [Agent/UI judgment](pr45-agent-ui-quality-review.md), [task/tooling judgment](pr45-task-tooling-quality-review.md), [config acceptance](pr45-config-quality-acceptance.md) and [history rejection](pr45-history-quality-rejection.md) retain scope and reasons. Rejections are resolved only by the matching repair receipts, not erased.
- Original tvly bibliography was found read-only in fc592efd:wisdom/quality/readability-guidance.md. References are now in [structural guidance](structural-readability-guidance.md). The rejected code and file-edit restriction were not imported. Current history judge also checked Google's primary source directly.
- The audit retains 788 unchanged accepted file hashes, including 385 maintained product/config/prompt inputs. Hash equality alone is not composition proof; the current journey reviews supply the changed-composition judgment.
- Two test-only lanes25/55 remain deferred. Three e2e/test scripts shared one older primary task, so strict one-primary-per-file compliance was not universal. Nine upstream additions lack historical coverage rows and are now covered by stated current quality reads. Do not claim a new individual primary task for each. This process history stays explicit rather than faking assignments.

## Safety checks, separate from quality

On integrated source ecbca439: 42 Fast tests / 300 expectations and 37 history tests / 135 expectations pass. Typecheck, paired build and compiled version0.16.18 pass. Root format passes after formatting this task's new inventory; two existing oversized-ledger warnings remain. No assertion/gate/config limit was weakened.

Evidence with argv/env/logs: /home/tnfssc/.bruv/agent/watchers/pr45-quality-validation-XoEs3z. Install used fresh private cache, copy backend and disabled lifecycle scripts; explicit guarded preparation passed unchanged. Tests use owned retained HOME/config/SDK/tmp; inspected existing hooks remove only acquired fixtures. No full local suite, 100k-model-context scenario, resource workload, live auth/provider/device or release run. Hosted CI is still required for the pushed tip.

## Ownership and next step

Owner checkout /home/tnfssc/.bruv/worktrees/pr45-readability-intent-owner-20261008, branch bruv/pr45-readability-intent-followup, based on published0d8066e4. The completed publication checkout and old coordinator remain untouched. PR45 remains open. Commit the receipts and this handoff, update the existing PR, then watch actual-tip CI. No merge/release authority.

Durable repair worktrees live under /home/tnfssc/.bruv/worktrees/t3-1dc1185b-5442693331ce-task_<id>:
- b0b6084b, branch bruv/pr45-history-quality-repair; repairda8daf2c, rejudge4a74c8e7.
- 5e042e9b, branch bruv/pr45-workload-quality-repair; repair1698525c, rejudgee3deff81.
- 9c720ca3, branch bruv/pr45-fast-selection-quality-repair; repair0ef23a5c, rejudge70454e34.
All reviewers and repair workers verified actual openai-codex/gpt-6.1-sol. Full task IDs and original review trees are in their receipts. Preserve saved work; do not resume old giant journals or recovery work.

Values unchanged. Existing actual-code judgment, coherent ownership and honest-proof values already say what was needed. This fixes their application, not their wording. Feature wisdom changed with each repair; guidance now retains its research sources.
