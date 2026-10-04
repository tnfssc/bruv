# Bruv native-Claude connector: implementation plan and ownership review

2026-10-03. **Design contribution only. No product edits, builds, installs, cache mutations or releases.** User authorizes full implementation after feasibility; parent integrates parallel findings and owns implementation/release decisions. This is a concrete design, with named hard gates rather than indefinite research.

## Decision and smallest real connector

Build an independent executable, **bruv-claude-compat**, implementing the process interface Claude Agent SDK consumes when external, unmodified T3 sets **pathToClaudeCodeExecutable**. This is not an Anthropic proxy/model SDK, genuine Claude Code, an ACP registry trick, or a new agent engine. T3 uses its native Claude driver; Bruv owns the actual Pi AgentSession, providers, tools, ordinary jobs, history and human decisions. Do not bundle Claude Code or copy its internal implementation.

Choose **direct pinned Pi SDK** as the implementation seam. One owning AgentSession per provider session; translation outside the agent. Normal bruv and its local/SSH roles remain unchanged. Separate executable, not environment-based autodetection, so T3-appended Claude flags never enter normal Bruv's parser. A configured instance and probe/help/version must identify Bruv clearly.

First vertical slice: no-provider-call SDK initialization/probe → truthful local model discovery → persistent root → real response → real execute tool with native permission request → foreground interrupt → resume the same Pi branch. Then extend that same slice to jobs, child UI, steering and the full parity inventory. **The first slice is not releasable parity.**

### Direct SDK versus PiRPC translation

| Seam | Existing evidence | Whole-product cost |
|---|---|---|
| Compiled Bruv + PiRPC translator | Published pi-acp 0.0.34 works for root/tools/late shell/cancel/load. Typed bruv_task_event, backgroundJobs, task-complete and agent_settled support a bounded local-job lifetime experiment. | Missing complete UI/permission/question/control facets; extra RPC correlation and process boundary. Environment inheritance can activate old native bruv_* routing. Additional root IPC would be needed anyway. |
| Direct Pi SDK, chosen | SDK assembly, RPC binding, disk journal and whole-lifetime late-wake proof exist. SessionHost, QuestionService and JobService already own work. | Small frontend binding plus native wire codec, but no reconstruction from incomplete RPC output and no second agent process. |

Reuse pi-acp lessons and fixture assertions, not its local-job debt tracker as a general scheduler. Do not add ACP to this transport or keep both routes as automatic fallbacks. If a real SDK seam blocks implementation, a PiRPC-backed implementation can replace the same runtime port explicitly; name and prove that blocker first. Never run two model/tool loops.

## Evidence and remaining contract inputs

Read wisdom/values.md and current wisdom/acp feasibility, wrapper/lifecycle, steering, hybrid UI, MCP and packaging notes. Inspected src/cli.ts; agent/extension; session host/input/operations; tasks manager/service/session/lifecycle and job delivery; T3 bridge/events; history/questions/Live authority. Read only official cached T3 under .cache/acp-t3-upstream-experience/source-nightly and public SDK boundary references; patched .cache/bruv-t3code-* is not official evidence.

Concrete findings:

- ClaudeAdapterV2 supplies selected model/tools/permission mode, native session/resume IDs, partial messages, settings/thinking, directories, MCP descriptors and appended Claude/T3 system instructions. Interpret or visibly reject each relevant input, not success-and-ignore.
- T3 capabilities probe awaits SDK initialization with **no model prompt**. Optional usage has a separate deadline. Connector initialization must make zero provider calls.
- Native T3 Claude provider has a bundled Claude model catalog and Claude-specific auth/status flows. A supportedModels initialization response alone does not prove Pi models or honest UI. Configure supported T3 custom models with genuine provider/model IDs; no OpenAI/Gemini-to-Sonnet alias.
- SDK allowedTools is preapproval, not availability; tools controls availability. Upstream task_status is not harmless read-only: terminal read acknowledges delivery.
- Existing t3BridgeEnvironment activates old native routing from T3_MCP_URL/T3_MCP_BEARER_TOKEN. Old MCP client only allows bruv_task_* and bruv_local_job_notify, **not upstream delegation methods**. Existing scrubber removes those two names, not all new injection variables.
- TaskManager owns in-memory local processes. Lifecycle journal and persisted task rows are evidence/projections, not a restartable detached-job service. Shutdown actually closes children. Old running rows cannot prove live work.
- QuestionRuntime distinguishes saved, queued, dispatching, delivered and resume-needed. SessionHost shares the actual task port. Live has an exclusive main-session owner and release boundary.

Parallel inputs: binary-contract.md, binary-spike.md, task-ui-contract.md and feature-parity-plan.md. Read the first two available contract documents before finalizing this plan (binary-contract and task-ui-contract); their consequential findings are incorporated below. Binary spike/parity acceptance remain parallel-owned. Pin verified T3/SDK revisions and packet fixtures before coding.

## Small component design

New feature-local src/claude-compat modules:

1. **cli.ts**: independent entry; version/help/auth-status probes, native stream flags, opt-in gate, stderr diagnostics; no CLI main/TUI or old-web import.
2. **wire.ts**: NDJSON framing/validation; assistant/tool/result/control envelopes; serialized output writer; correlated unsupported controls. No initialization model turn.
3. **runtime.ts**: construct/restore pinned Pi AgentSession, bind as RPC, retain lifetime subscription, own awaited teardown. Prompt/steer/followup/interrupt/model/commands use one session authority.
4. **frontend.ts**: real UI and permission requests to SDK controls, correlation, command dispatch; access existing SessionHost/question/Live ports, not a second dispatcher.
5. **projection.ts**: typed agent/tool/session/task events → native presentation, stable identities, transcript/output files, usage/replay. Cannot launch/stop work or mark owner delivery.
6. **mcp.ts**: per-session host-only MCP discovery/tool registration and explicitly named T3 app delegation. Separate from old Bruv-specific bridge.

Use an existing Pi custom entry for versioned compatibility metadata: native session UUID, actual Pi session/branch/checkpoint association, translation version and stable request receipts. Derive indexes/transcripts from source entries. Persist non-reconstructible admission/delivery correlation only where no existing owner stores it; **no second task/session database**.

### Boot and composition

Preserve cli.ts initialization order: Bruv runtime/product paths and identity → Bun OAuth → pinned Pi host check → disk-backed SessionManager installation → dynamic Pi/extensions imports. Extract only a small shared headless bootstrap; do not load TUI startup installers. prompt-preview.ts demonstrates SDK assembly, but its transient/offline storage is not production persistence.

Persistent SessionManager, cwd-bound settings/resource loader and ModelRuntime; load Bruv tools/state/remote/Live composition as applicable, not a plain Pi session. Bind AgentSession.bindExtensions as RPC before prompts; frontend supplies actual input/select/confirm/command actions. Subscribe for process lifetime. Use AgentSessionRuntime awaited shutdown, not synchronous dispose alone.

Claude preset/system instructions are transport inputs, not authority to replace Bruv identity, tools or role policy. Preserve Bruv system prompt; include relevant workspace/T3 context as explicit host instructions. Expose real Bruv tools, not nonexistent Claude skills/plugins/hooks/sandbox features. Unsupported tools/settings/modes visibly reject.

## Explicit owners and orchestrator split

| Entity | Authority | Connector |
|---|---|---|
| App thread/root run/queue and app-owned child | T3 | Submit/read through SDK controls and scoped upstream MCP |
| Pi branch/model turn/tools and ordinary local jobs | Bruv | Preserve extension/task/session owners |
| SSH placement/source/grants/task delivery | Existing Bruv remote backend | Preserve IDs and pending/unknown semantics |
| Saved human question/capability answer | Existing Bruv question/grant owner | Project human controls, save through owner/version API |
| Native transcript/artifact/usage UI copies | Derived | Regenerable view; never drive state from prose |

**Default:** ordinary Bruv root and subagent behavior retain fast/normal/orchestrator profiles, bounded nesting, workspace/SSH semantics. Hosting in T3 does not itself make the root a normal worker. Normal CLI roles stay as today.

**Explicit T3 orchestrator workflow:** upstream delegate_task owns its app child. Select a supported T3 provider configuration running Bruv in a host-enforced **normal worker** profile. Child cannot delegate. This must be configured/trusted, not inferred from model-authored role text. Test upstream target selection. T3 app tasks and Bruv subagents have distinct tool names/IDs/results. task_status/task_cancel are not aliases for jobs.inspect/stop.

If no trustworthy profile parameter exists, a second clearly named locked normal-worker executable/profile can share the runtime code. Do not derive worker policy from caller-controlled role/session strings. If upstream cannot select that configuration for children, the split is a named gate, not locally emulated T3 ownership. Never call absent bruv_task_launch upstream methods. Do not import T3 tasks into TaskManager.

## Threat/permission/MCP review

Root connector is host code. Capture only provided thread-scoped MCP descriptors/credentials into per-session memory; remove injected credentials/control variables from process.env **before extension initialization or tools**. Keep bearer values out of prompts, saved metadata, child environments, stdout/errors and artifacts. Root server discovery occurs in that session's host MCP connection.

Use one clean child-environment factory at TypeScript execute, shell/local-agent, SSH-bootstrap, MCP-stdio and helper boundaries. Explicitly strip old T3_MCP_* and new T3_ACP_MCP_* names, other injected T3 orchestration controls and root socket tokens. Preserve Pi provider auth via its actual auth storage/mechanism. Inherited Anthropic auth from T3 is not proof Bruv is authenticated. MCP stdio children get their own configured server environment, not all servers' credentials.

Each native query owns its MCP connection, available tools and permission policy. Config/server replacement closes the old connection; outstanding responses stay bound to old request/session. Root credentials are never child credentials. T3 app children receive upstream-issued scopes; ordinary Bruv children get no T3 root tools. Fail incomplete config; no fallback to old native bridge.

Discovery is not approval. Enforce tools selection separately from allowedTools, actual permission mode and canUseTool/control decision. MCP descriptions/model text cannot grant authority. Mutating upstream calls keep active-run/provider checks. Do not retry ambiguous delegate_task commits unless the verified contract supplies a stable dedup key; otherwise report unknown and inspect actual state. No fictional exactly-once guarantee.

**execute is arbitrary TypeScript.** Renaming it Bash, parsing source for apparent read-only behavior, or forwarding narrow Bash approval is permission spoofing. Ask for the actual execute call/schema and display submitted code/label. In plan/read-only mode arbitrary execute cannot be authorized; until a genuinely enforced read-only executor exists, disable/reject that tool and show the limitation. Denied calls cannot reroute through another tool. Trusted normal CLI keeps existing behavior.

Stdio/local peer and caller-supplied role/session IDs are not proof of T3 identity. Enforce configured executable policy/session ownership; never elevate answer/delegation authority from input strings. Full-access same-user arbitrary code is not an OS sandbox; credential scrubbing still matters, but is not a claim of filesystem isolation from all same-user secrets.

## Durable control/delivery and native root lifetime

Keep IDs distinct: T3 thread/run, SDK native UUID, Pi session file/ID/branch, toolCallId, control requestId, Bruv task ID including ssh:..., T3 app task ID, MCP transport session and credential-provider identity.

Admission persists input/message ID → Pi user entry/checkpoint before dispatch. Replay reuses identity; conflicting replay rejects. Wire write acknowledges transport only, not model execution, tool completion, job closure or answer use. Underlying job response acknowledgement stays at src/job-delivery.ts; a synthetic launch receipt cannot acknowledge a real job early.

Track separate dimensions: admitted input, active Pi turn/execute, steer/followup queue, background jobs, pending completion/question/remote delivery. background:true finishes a **launch receipt**, not the child. Actual task terminal and actual task-complete/custom delivery consumption are separate boundaries. Native task-start/progress/notification derives only from typed manager/service/remote/task-row events and sourceCallId. A label/stdout tag cannot create a subagent.

Steer uses Pi safe-boundary steering; followups retain identity/order. Input during interrupt cannot join the cancelled caller or receive false executed acknowledgement. Native controls reply once to their own ID; stale response never resolves newer request. Model change applies at actual safe session boundary; report selected vs effective model honestly.

Native result boundary follows the parallel spike/UI proof, **not ACP prompt ownership**. If native T3 keeps the query alive and owns task-notification wake, preserve that exact path. If late continuation is only legal under an open root run, keep the real running boundary until delivery drains, not an arbitrary sleep. If neither yields correct Stop/replay/concurrent-input behavior, full integration is blocked: no hidden polling or fabricated user prompts.

**Native control interrupt** initially aborts foreground input/execute, not jobs.stopWork. However, verified native T3 **Stop sends interrupt then closes the query**. EOF/SIGTERM is therefore an owning-runtime shutdown: await session_shutdown/TaskManager subtree closure, never orphan its jobs. T3 Stop must be documented as foreground + process-owned background closure, unlike normal Bruv CLI foreground Stop. Preserve a separate same-session Bruv foreground-only command/control equivalent if parity requires it; test that T3 does not subsequently close that query. jobs.stop(id) and jobs.stopWork retain their actual owner/report semantics. T3 app task cancel is separate. Pending/partial/unknown remain visible; no cancellation of unrelated CLI sessions.

No extra resident supervisor in the minimum. Browser reconnect uses the surviving T3 backend/query where supported. Actual backend/process exit closes local ownership or leaves crash-uncertain closure; reopening reconciles evidence and shows interrupted/unknown, never relaunches old running rows. Existing SSH tasks/outboxes retain their actual durability. Add a supervisor only after a demonstrated requirement and an explicit parent ownership decision.

## Save/resume, native history and artifacts

Map external native session UUID to owned Pi storage via compatibility metadata/index, never an arbitrary resume filepath. Preserve new/fork/branch operations. resume-at maps to actual Pi entry; unknown checkpoint rejects instead of silently resuming latest. Branch switch invalidates former pending controls/Live owner. Restore questions/outboxes from their actual source, not rendered transcript.

Write native transcript/child files **only in the paths the verified T3 adapter actually consumes**. Derived views live in an explicit connector-owned config home; never mutate real ~/.claude account/history. Canonical Pi JSONL and artifacts remain in Bruv storage. Stable replay IDs derive from Pi entry+block ordinal or task/delivery identity; capture non-reconstructible stream IDs before exposure. Rebuild projection without reexecuting tools. Preserve toolUse/sourceCallId/task linkage.

Reuse execute capture/output buffers and artifacts; show truncation/lost output/capture errors/cursors. Task output paths must reference real per-job/child output. If native T3 needs an unpersisted file, add sink at the task owner's hook, not connector polling or fake transcript. Private regular files; no publishing whole private caches. No invented output paths/full histories.

Usage comes from actual provider totals/cache/cost with unknown/estimated semantics. No duplicate charging final+assistant usage or folding child costs into root Anthropic tokens. Account/email/subscription/rate limits absent unless actual provider supplies them. Local credential readiness != verified API access. Unsupported Claude billing/credit/usage endpoints say unavailable/unsupported, never fake zeros or subscription.

## Feature availability via T3 equivalents

Exhaustive inventory belongs to feature-parity-plan.md; this design supplies these implementation paths:

- Text/images/files, progress/diffs/results, model/thinking/fast mode, compaction/shake, history/branches/jobs/child monitors: native query/control/presentation and real supported Bruv commands. Models are genuine provider/model IDs.
- Goals/profiles/settings/wisdom/prompt preview/diagnostics: initialization command list only for implemented commands dispatching to existing runtime/services. No fabricated Claude built-ins.
- Questions: saved Bruv ledger projected into verified human input/dialog control. Human response saves current owner/version then uses existing new-turn delivery. AskUserQuestion-shaped presentation is a view, not another suspended tool stack. Reload shows pending/resume-needed. Model text and generic permission approval cannot answer a saved question. If native durable input is missing, integrated-terminal workflow must connect to **the same owner/session**, not an unrelated bruv invocation.
- Remote targets/source grants/worktrees: existing authorization/discovery/approval; native server-scope constraints unchanged. No credential transfer/automatic untracked approval.
- Live: preserve exclusive main-session owner, awaited stop teardown result and unchanged jobs. Server-side audio is not browser mic/playback. Terminal/device equivalent is acceptable only if same intended session/owner and actually functional. Remote/browser-required audio needs real transport; missing implementation remains a full-parity gate, not a dropped feature.
- Terminal/Git/editor/PR controls remain T3-owned when they already serve the task. Auth/device setup can use explicit integrated-terminal help; not permission to shift all missing core features into unrelated CLI sessions.

**Honesty gate:** external T3 must allow visible Bruv identity/configured instance, real models, absent Anthropic account/quota and no false baked-in capabilities. A passing executable fixture does not prove this. If hard-coded probe/UI makes it impossible, report exact blocker and smallest supported setup/upstream change rather than impersonating Claude to avoid any T3 edit.

## Independent implementation worktrees / file map

Pin a parent commit; separate worktrees, no shared production checkout edits. Freeze a small owning-runtime/frontend/task-event port, not a plugin framework.

| Package | Owned files/changes | Deliverable |
|---|---|---|
| A codec/entry | New cli.ts, wire.ts, tests/claude-compat/wire*.test.ts, isolated driver | Verified probes/flags/errors/events; no Pi/domain edits |
| B SDK/frontend | New runtime.ts/frontend.ts; small headless bootstrap; required src/pi-host.ts/session host-access/operations facets; binding tests | Single session, permission/command/input/branch/interrupt port |
| C isolation/MCP | New mcp.ts; src/delegation-environment.ts and necessary tasks/typescript/remote child-env call sites; isolation tests | Per-thread tools/policy and no old native routing; explicit app delegation |
| D tasks/replay | New projection.ts; minimal owner event/artifact hooks in src/tasks, src/agent/extension.ts, src/history; replay tests | Stable child/sourceCallId/output/usage projection, no scheduler |
| E parity adapters | Existing question/goal/Live domain adapters/tests after B port freeze | Saved decisions and same-session human/device workflows |
| F packaging/acceptance, parent after A–E | scripts/build.ts/packed-web.ts, src/cli.ts web command, README/package/CI/install/notices; obsolete src/t3/web and integrations/t3/build paths | Clean external-T3 install plus unchanged CLI/SSH roles |

B–E use owning-runtime operations, typed task subscriptions, saved-question frontend actions, wire-delivery status and command/probe facts. Agent composition changes have a single integration owner: don't cherry-pick competing extension roots. A/B produce real slice; C/D/E run independently once port/packet fixtures freeze. F removes bundle **after** whole acceptance. Preserve independently owned rolling-activity repairs.

## Exact development gates and safe removal

**Development only:** new source entry bun src/claude-compat/cli.ts; require **BRUV_CLAUDE_COMPAT=1** until parent acceptance. Gate absence fails before Pi/credentials; never gate normal bruv/remote internal paths. Process title/help/version say Bruv with real version. Native startup has no old-web import.

Run under isolated HOME/XDG/BRUV_CODING_AGENT_DIR and env allowlist, deterministic local model endpoint; initialization asserts zero provider requests. Authenticated checks need authorized credentials, not cached peer secrets. Build separate connector only after parent integrates feasibility. Existing package test runs full web+CLI build, so focused tests must not invoke it accidentally.

Release gates:

1. **G0 boundary:** unchanged external T3 + real SDK + own labeled executable; initialize/probe/control/model packet fixtures pinned.
2. **G1 root:** real Bruv SDK session/tool/files/provider; truthful models/auth/usage/commands; real denial; zero old bruv_* upstream calls/credential leakage.
3. **G2 lifetime/owners:** normal and bounded nested orchestrator children, shell monitor, explicit T3-owned normal child if enabled; safe steering/followup/late wake; foreground vs child vs whole-work stop; actual process closure and visible pending/unknown.
4. **G3 continuity/parity:** reconnect/restart/resume/fork/checkpoint; saved decision recovery; artifacts/usage/replay nonduplication; complete parity inventory and real terminal/device equivalents. Native panels are true state, not renamed unrelated tool badges.
5. **G4 packaging:** compiled connector and normal/SSH bruv installed cleanly; no bundled T3 default; tested setup/docs; preserved data and rollback/read-only recovery. Only then release.

### Explicit bundled-T3 disable

Final default **bruv web prints versioned external-T3 installation/configuration help and exits**. It must not import/extract/start embedded T3, auto-install latest or silently rewrite external settings; label setup help honestly, not a ready server. Remove static archive import graph and unconditional prepareWebPayload from default build: a runtime env toggle alone still bundles it.

An optional bounded transition can keep a separately named explicit legacy build target, never detection/fallback. Preserve ~/.bruv/web, ~/.bruv/agent and runtime caches; no deletion. Do not point external T3 at patched old web state as assumed migration.

Compat captures/scrubs native credentials and bypasses old src/t3/tasks/mcp-client.ts adapter. Normal CLI/authorized SSH/native roles keep required code until callers are traced. **launch-identity.ts is also used for SSH correlation: do not delete src/t3 wholesale by name.** events.ts may become transport-neutral projection if used; events never gain authority. Remove old patched web producer/payload/dependency/notices/CI/promises together only after identifying survivors.

## Integrated native-contract specifics (not speculative protocol)

The parallel boundary/UI reports pin official T3 **fed41fa88bb27cb4325cb208d571393850bc63c2** and its installed Claude Agent SDK **0.3.276**, not the earlier ACP SDK version. Read their full tables for exact packet and transcript fields. These findings override provisional assumptions above:

- No observed signature/genuine-Claude handshake at the subprocess seam; independently written NDJSON is feasible. This is transport proof, not real Bruv/UI acceptance.
- T3 uses SDK initialize + get_usage for health, **not auth-status subprocess**. Successful initialize is marked authenticated even with account:{}. Connector must not emit a successful initialized-but-no-provider-auth state just to green that indicator. Decide an explicit truthful auth-ready/error contract, and test the configured instance's rendered identity/account semantics. No-provider-call local readiness can remain unverified access; if T3 cannot distinguish that honestly, accurate status is a named host-owned blocker.
- Implement observed common stream flags from binary-contract, including SDK tool selection/preapproval, stdio permissions, settings/thinking/effort, session/resume/checkpoint, MCP config and no-session-persistence probes. Unknown behavior-affecting flags reject.
- **Auxiliary native CLI mode is required:** title/branch/commit/PR generation directly invokes -p --output-format json --json-schema with plain stdin, tools empty and dontAsk. Add this to package A/B: use the same actual Pi model runtime, validate schema and emit actual structured_output or explicit failure. NDJSON-only integration misses real T3 features. Ephemeral probe/auxiliary sessions must not start jobs or mutate main history.
- Steer is an ordinary user frame with **priority:now**, not interrupt/control/ACP. Route directly to Pi's safe steer path; preserve UUID echo/admission. Native Stop closes the query after interrupt, as corrected above.
- T3 preserves live queries for known background work and buffers actual idle completion/wake output into a **T3-owned continuation run**. Keep a single Bruv execution/message source and let T3 adopt the truthful native wake lifecycle; do not trigger another connector-generated model prompt as well as Bruv's existing notification turn. Prove one model continuation and correct queued-user ownership. Model/policy changes cannot destroy pending jobs silently.
- Individual provider-native child UI is limited: native adapter does not expose stopTask, child close/wait/fork or live child-thread messaging. Child shell is projection, not a runnable duplicate session. Preserve jobs.stop/inspect and real child messages through supported same-owner commands; do not promise child-panel controls the adapter lacks. Shell monitor roster requires actual watcher semantics, not a job list renamed Monitor.
- Official delegate_task has **clientRequestId**, real app task/thread/run/node IDs, target/mode and inherited workspace. Use a stable owner-bound request key and verify replay guarantee before retry; independent worktree launch remains separate. Do not conflate Bruv profiles/depth with its prompt-only role field.
- **SDK fork is filesystem-only:** forkSession reads native transcript, follows UUID parent/side chains, slices at checkpoint, assigns fresh UUIDs/sessionId, writes a fork; T3 sends no wire fork request. getSubagentMessages also reads native storage. Package D must produce compatible real root/child files and support importing/adopting an SDK-created fork into a new Pi branch/session without reexecuting tools. Use verified retained provenance/native source-entry mapping; do not guess fork ancestry from matching prose. If SDK discards all usable provenance, a validated native transcript import can create new Pi history with explicit imported ownership, but cannot grant old task/question authority. State that boundary clearly and test actual fork result. A --fork-session flag alone is insufficient.
- **Config-home alignment is a hard storage gate:** T3 per-instance homePath affects executable env, while SDK fork gets dir/checkpoint, not that child env. Verify a connector-owned location the parent SDK actually reads. Do not write real ~/.claude or claim isolated fork support if parent SDK reads elsewhere. No second canonical transcript/task authority; native files are interoperable derived views/import inputs.

These are finite implementation/proof tasks. Start independent A/B/C on the feasible wire/session seam while D proves storage; fail whole-product acceptance honestly if identity/status, actual fork-home alignment or same-session parity cannot work unchanged upstream.

## Parent next actions

Read four parallel contract/parity findings, replace unverified native/UI assumptions with exact proof, freeze packet fixtures and start A/B plus C if spike succeeds. No extra broad research round needed. Review actual permission/worker-profile/late-result boundaries as slice lands. Integrate D/E and whole parity acceptance; name any real hard-coded provider/device/history blocker. Parent owns build/removal/release after normal/SSH CLI regression checks.

Values unchanged. Applies existing one-owner, truthful proof/UI, durable admission and safe-data values; no new general rule established.
