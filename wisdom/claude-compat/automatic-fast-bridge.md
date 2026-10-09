# Automatic T3 Fast bridge

Task task_5c56611b. Worktree: /home/tnfssc/.bruv/worktrees/t3-1d0882e1-5442693331ce-task_5c56611b. Branch: bruv/honor-t3-fast-automatically-in-bruv-5c56611b. Base: de874ac9 (assigned origin/develop). No PR69 cherry-pick, manual Fast command, T3 edit or installed binary change.

The user approved current-choice semantics. A saved, authenticated T3 Fast=true choice is already premium consent. Queued messages use that choice when Pi consumes them, not an enqueue-time or historical run snapshot. No second cost prompt or command.

## Owners and timing

- cli.ts keeps its existing Bearer-injected t3-code classification. mcp.ts also checks that credential-bearing HTTP injection before enabling its connector-only read. The read calls only t3_thread_configuration with fixed empty args on the existing connection. It does not use model tool selection, authorizeTool or the generic active-run permission path. Those paths are unchanged.
- The response must contain a current threadId and instanceId, and its model must exactly match the owning Pi provider/id. T3 binds the thread/provider instance through the authenticated connection. There is no independently supplied launch thread/provider-instance ID; none is invented, taken from token contents or inferred from environment. Cross-model and cross-provider selections cannot grant Fast.
- runtime.ts uses onUserMessageCreated object identity to mark genuine inbound root messages. An awaited extension message_start consumes each mark before dispatch. before_agent_start still owns MCP lease reacquire; it does not sample Fast. This covers queued follow-ups without adding a queue or another lease retry.
- A streaming priority-now steer is not marked. Task wakes, tool rounds and retry dispatches are not new inbound root consumption. They keep the running turn's choice.
- Matching true calls the existing nativeFast.setWithCostConsent. Matching false or absent clears the existing persisted opt-in. The native owner still binds session/model/auth, checks provider support and owns request tiers. JobService still owns fresh local-child environment inheritance and model/thinking profiles.

A failed, malformed or mismatched read clears Fast and shows an error notice. The turn continues with Fast off. There is no read retry or quiet reuse of stale premium consent. Existing native opt-out protection also applies if saving off fails.

Explicit --settings fastMode and idle apply_flag_settings support remain. Without authenticated T3 they keep their existing meaning. With authenticated T3, the current choice wins at the next root consumption, even over an earlier explicit host true or false. This leaves those explicit controls usable for non-T3 and a future fixed host, without giving them precedence over this host's current saved choice.

## Proof

Read-only T3 source: /home/tnfssc/.bruv/upstream-preparation/t3-fast-mode-fix. Checked thread/tools.ts and thread/handlers.ts plus the instance-keyed ModelSelection and option-array contracts. Existing native Fast and claude-compat host-trace wisdom supplied the ownership and consent seams; its earlier historical-snapshot objection is not the approved semantics here.

Tests in tests/claude-compat/t3-fast-bridge.test.ts use an actual SDK HTTP MCP peer, offline AuthStorage/ModelRuntime, real Pi admission and the pinned Responses serializer:

- Production runConnector accepts native injected MCP and selects priority, then default in the same process, without a Fast flag or command.
- A blocked configuration response blocks provider dispatch. A queued follow-up does not read at receipt. Changing Fast before its consumption selects default, while an intervening steer keeps priority. A later task wake does not read. Tool execution changes saved Fast but its next tool round keeps priority; the next fresh root turn reads off.
- An offline custom Astra/high parent selects priority. Real JobService normal launches retain the Sol/high profile and env=1. A distinct fresh Pi child from that environment serializes priority. False and absent each clear persisted parent true, produce default parent requests and env=0 for fresh normal children. An existing authorized child remains unchanged.
- Unavailable/mismatched config visibly clears stale true in one read. A matching server name without Bearer injection supplies no consent. Generic model tool selection/permission restrictions still hold. Explicit non-T3 host controls still select priority.

Direct bridge suite: 8 pass / 0 fail / 83 assertions. Six focused outer suites (bridge, existing host Fast, MCP, connector runtime, native Fast, JobService): 60 pass / 0 fail / 365 assertions; isolated inner suites add their own assertions. Logs live in .tmp/bridge-*.log. All test HOME/config/TMPDIR state belongs to this worktree; /tmp was full and was not used.

bun run check, focused format and git diff --check pass. Focused lint passes with no errors (9 warnings / 15 infos, including existing diagnostics). Early checks caught test SSE/import/loadout mistakes and MCP result typing; fixed them rather than dropping assertions.

## Worker handoff (before parent validation)

No live provider call, billing/latency claim or upstream model availability proof. Astra/Sol here are explicit offline custom catalog fixtures. Local child spawn is captured from JobService, then a real separate Pi runtime is booted from the captured environment; this is not a live binary child process. No app-owned task-backend or SSH Fast claim. Metadata/display is the parent's separate check. Parent owns review, build, integration, shipping and any PR or install.

Values reviewed and unchanged. Existing outcome/recovery, one-owner, human-flow and scoped-proof values cover this correction. The lesson is to honor the user's existing choice and clear inherited stale state, not add another consent workflow.

## Parent review and packaged proof

The user approved this automatic path after rejecting PR69's manual command. PR69 is closed. This branch starts from de874ac9, without that command change. The old local Bruv0.16.23 manual build was replaced by the tested automatic build; T3 is still untouched. The prior worktree /home/tnfssc/.t3/worktrees/bruv/t3-1d0882e1 holds its rollback 0.16.22 pair under .tmp/fast-build/previous-bin.

Parent built the normal/connector pair and ran .tmp/parent-acceptance/automatic-smoke.ts. The real packaged connector used a local authenticated MCP fixture and process-local mocked Responses fetch. Saved true sent priority; false and absent sent default in the same process, with exactly one config read per root message and no Fast command or flag.

The separate automatic-child-smoke.ts made the packaged parent call execute/subagent and launch actual fresh local child processes. Astra requests used priority with Fast on; normal children kept Sol/high and also sent priority. False/absent sent default in the parent; fresh children kept Sol/high and omitted priority, using ordinary provider tier selection. Three consumed roots made three config reads. Requests were intercepted before network; no paid calls, live billing or model-availability claim. Evidence lives under .tmp/parent-acceptance/run-1791582392228. Early harness-only failures were string escaping and expecting explicit default from fresh children; existing disabled inheritance leaves children without a Fast entry, so the correct assertion is no priority.

Independent review task_e53f2d2d found one real bug: a blocked config read ignored Stop/input abort and could delay close. Parent reproduced it with a gated response. The read now combines the existing turn abort signal with MCP lifetime and checks it before applying a reply. Input abort reaches that same turn signal. Cancelled reads clear stale Fast without an error notice. Three gated regressions now pass (interrupt, input abort, close), with no provider dispatch and no persisted true after cancellation. Other reviewed timing, auth, parsing and inheritance paths had no blocking findings.

Final checks: 46 regression tests plus 14 MCP tests pass; the direct bridge suite has 11 tests / 92 assertions including cancellation. Typecheck, focused format and diff checks pass. The first parent test command named the MCP file incorrectly, so it ran five files; reran the actual mcp.test.ts separately. Rebuilt after the cancellation fix and repeated the packaged actual-child check successfully.

Installed only Bruv through the normal paired installer, after verifying the installed hash still matched our rejected manual build. The installed pair reports 0.16.23; this is a local automatic-bridge build, not a newly published release. The installed binary and its actual child processes passed the same offline Fast true/false/absent check. Evidence: .tmp/parent-acceptance/installed-final.log and run-1791582720976. The manual T3 command extension is absent from this branch. Existing running connector processes still hold their old code; new/restarted Bruv sessions load this build. No T3 service restart, patch, or settings mutation occurred.

The pinned host's child bar accepts modelLabel and effortLabel, not a Fast field, and projecting a different child model drops options. This Bruv change fixes actual parent/child request behavior, not that host display. Do not decorate model identifiers or claim a child badge was fixed. No paid provider billing/latency claim.

Parent-owned scripts/logs remain under this worktree's .tmp. The initial parent checkpoint was folded into this note and removed. Values unchanged: existing user-outcome, one-owner, Stop ownership and proof-scope guidance already cover this correction.
