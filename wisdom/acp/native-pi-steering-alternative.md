# Native Pi steering alternative — bounded research, not an ACP migration

**2026-10-03. No T3 edit/build/release; no Bruv rebuild; no real provider credentials.**

## Bottom line

The literal proposed configuration, native Pi **binaryPath=/home/tnfssc/Code/bruv/dist/bruv**, is **blocked before runtime**: actual upstream settings UI reports **v0.15.28, Unavailable · Unsupported**. Official PiProvider interprets Bruv's product version as Pi's engine version and requires **Pi >=0.80.5**. Exact source message: **“Pi 0.15.28 is unsupported. Update to Pi 0.80.5 or newer.”** This is a health/version gate, not a demonstrated Pi RPC incompatibility. Native Pi settings offer no gate override; launchArgs are not applied to the --version probe. A future intentionally chosen native route would need a Bruv-owned compatibility/version entrypoint design, not this deceptive research shim.

An **explicit RESEARCH-ONLY version shim** subsequently demonstrated the desired native steering wire path through the **real upstream UI** with the **unchanged external compiled Bruv**: Queue correction → rendered **Steer** → click Steer → actual Pi **prompt, streamingBehavior:steer**. The running execute tool completed; Bruv then consumed the correction; T3 rendered the corrected answer. No abort/restart command or second agent_start occurred during that run. Ordinary idle continuation also worked.

**Do not call this unchanged direct-binary acceptance.** The shim lies about --version (1.0.0 instead of 0.15.28). It is not a product recommendation, packaging change, supported migration, or authorization to replace ACP. Native Pi could be a separate T3-specific interface while ACP remains the other-client interface, but choosing that architecture remains a user/parent decision.

## Provenance and method

- Unmodified official nightly **@t3code/t3-linux-x64@0.0.46-nightly.20261003.2623**, parent-owned .cache/acp-t3-upstream-experience/platform/t3; SHA256 **2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795**. Source review is the official fed41fa nightly extraction, not the patched Bruv T3 checkout.
- Unchanged parent-owned dist/bruv SHA256 **5da33808892cf3c28ea9816a2e2271c183ddbcd792f7a2893483a40fcde13965**; --version is 0.15.28. Source dependency pi-coding-agent is 1.0.0; that is **not** what the binary version probe reports.
- Own workspace/state/port: **.cache/acp-native-pi-alternative**, loopback T3 **18786**, dynamically assigned loopback fake OpenAI Responses model, isolated HOME/agent/BRUV_HOME/T3 base. Server environment was explicitly constructed, not inherited from the research parent. No actual model/provider auth store used.
- First actual UI setup used **native Pi** (no registry-ID borrowing), added an instance, and set binaryPath directly to dist/bruv. The direct failure is retained in evidence.
- Subsequent .cache/acp-native-pi-alternative/RESEARCH-ONLY-version-gate-recorder.mjs changes **only --version**. All runtime arguments, environment, stdin/stdout records are forwarded unchanged to external dist/bruv. Stderr content is suppressed and recorded as byte counts, not forwarded or saved. **No MCP/extension filter** was used. This is a modified research launch, never a product/upstream patch. The settings display-name edit did not persist; retained UI still has the original direct-binary label. Read the stage/provenance here and the actual launch manifest, not that stale label.
- Recorder saves a strict metadata whitelist: types, RPC IDs/commands, success, streamingBehavior, controlled marker names, roles, error lengths, and T3 environment **names only**. Injected extension path is replaced with a placeholder. No message bodies, model request bodies, authorization, MCP URL/token, stderr content, or raw environment dump is recorded.

## Actual acceptance slice (research shim only)

An initial manual attempt finished before Queue was clicked; it is **not steering proof**. A fresh second thread then used one scripted UI action to avoid that timing mistake:

1. Submit NATIVE_WORK. Real execute writes work-started.txt, waits 14 seconds, writes work-finished.txt, prints NATIVE_TOOL_COMPLETED. It uses Bun/file APIs and a timer, **not a child shell**.
2. While Execute was active, enter NATIVE_CORRECTION, click Queue message. Actual UI showed **Queued 1** and a **Steer button**.
3. Click actual Steer. Recorder captured **prompt / streamingBehavior:steer** at **1791037869948**, followed by queue_update and successful prompt response. Tool_execution_start was **1791037868211**; tool_execution_end was **1791037882411**. The correction arrived during work, not after it.
4. Engine then emitted the correction's user message and NATIVE_CORRECTION_APPLIED_TOOL_PRESERVED, followed by agent_end and agent_settled. File content is COMPLETED_WITHOUT_ABORT. Exactly one agent_start belongs to this run; no abort RPC was sent anywhere in this trial.
5. T3 showed the committed correction labeled **Steer**, the corrected assistant answer, and a restored composer. A subsequent ordinary NATIVE_IDLE prompt produced **NATIVE_IDLE_CONTINUATION_OK**. Its wire prompt has no streamingBehavior:steer.

This proves safe-boundary steering, preserved foreground tool completion and rendered corrected output for the controlled loopback fixture. It does **not** prove retroactive change to an already-running command, real-model instruction quality, background descendants, shell credentials, all permissions, crash recovery, or general protocol parity.

## Exact official implementation review (source, unless called actual above)

Paths below are relative to .cache/acp-t3-upstream-experience/source-nightly/.

- **apps/server/src/provider/Drivers/PiDriver.ts**: registered native driver kind pi, creates PiAdapterV2 from enabled/config/environment; instance environment merges over host environment. Native maintenance/update targeting is the Pi npm package, **not Bruv**. Do not press Pi's update action as a Bruv installation strategy.
- **packages/contracts/src/settings.ts:836–867**: Pi enabled defaults false; supported configuration is binaryPath, launchArgs, hidden customModels plus ordinary provider-instance environment variables. There is **no Pi homePath setting**. Use HOME/PI_CODING_AGENT_DIR/BRUV_CODING_AGENT_DIR explicitly for isolation. ProviderInstanceEnvironment.ts copies host env and applies string overrides; most values receive no shell expansion.
- **provider/Layers/PiProvider.ts:77, 247–408**: --version gate precedes discovery. Discovery launches --mode rpc --no-session without injected MCP/permission extension and requests get_state, get_available_models, get_commands. Actual recorder confirmed those commands succeed behind the shim; UI then reported Authenticated · pi against the local fake key, not real account authentication.
- **orchestration-v2/Adapters/PiAdapterV2.ts:390–430** and **piT3McpInjection.ts**: live runtime gets --mode rpc, configured launch args and materialized --extension pi-t3-mcp-extension.ts; environment adds T3_PI_RUNTIME_MODE and, when present, **T3_MCP_URL/T3_MCP_BEARER_TOKEN**. Inherited copies of those two credentials are deleted before installing current-session values. Launch args cannot override T3-owned RPC/session identity; no --no-* flags are automatically applied to the ordinary live session. Normal user extensions/settings/context still load.
- The injected extension loaded successfully in this actual trial: live logs show --extension and the three T3 environment names; no extension_error event was observed. It uses Pi's public tool_call hook and MCP client, not ACP.
- **PiAdapterV2.ts:143, 2407–2452**: supportsActiveSteering:true, supportsSteeringByInterruptRestart:false; steerTurn uses prompt with streamingBehavior:steer, not direct steer or abort/restart. Session event permit and generation fence prevent stale settlement overtaking steering. A prompt racing engine idleness can start work rather than leave a direct steer permanently queued.
- **PiAdapterV2.ts:1510–1920**: agent_end is **not** terminal; agent_settled schedules get_state idle confirmation, checks isStreaming/isCompacting/pendingMessageCount, then finalizes. Fire-and-forget prompt acknowledgments are tracked by session-wide send order and owning provider turn. Dialog responses share the settlement permit. Actual wire showed get_state/get_entries after settlement.
- **piT3McpExtensionSource.ts:234–247**: non-full-access tools require a blocking confirm, except read-only builtins; auto-accept-edits exempts edit/write. That generic hook covers execute too. **Trial used Full access only**, so permission dialog settlement/cancel is source-reviewed, not proven here. Extension select/input/editor map to T3 user-input requests; that is not Bruv's saved-question system. Capabilities mark approval callbacks live-only, pending requests not surviving restart, and runtime-mode switches requiring a process restart; steering within a fixed mode does not change that.

## What steering does not solve

| Area | Finding and evidence level |
|---|---|
| Early return / automatic late output | **Still a lifecycle/composition issue, not solved by this spike.** Official PiAdapterV2.ts:478–484,1551–1557 terminates unsolicited agent_start when no T3 turn owns it. It cannot simply accept autonomous late Pi turns after settlement. Holding an owning root turn until work is done may help, but was not tested here. |
| Existing Bruv-owned T3 lifecycle | Current src/agent/extension.ts detects native MCP env and routes local job completions into T3LocalNotificationDelivery instead of an unsolicited Pi prompt; src/t3/tasks/local-notifications.ts calls **bruv_local_job_notify**. MCP client allows **bruv_task_launch/observe/cancel/list** plus that notify tool. **Official fed41fa server has none of those names** (source search); its orchestration MCP exports delegate_task/task_status/task_cancel and thread tools. Therefore existing patched-T3-owned lifecycle is not a working unmodified-upstream bridge by assumption. Background delivery needs an explicit Bruv-owned compatible strategy, not a claim that native steering repaired it. Not exercised in this trial. |
| Tool/job graph | Actual proof is one foreground execute tool; native adapter projects ordinary tool events. PiAdapterV2 source says native subagent thread IDs absent, wait/close/fork unavailable, installed subagent extensions best-effort. Bruv jobs/subagents can target its custom native MCP contract; official delegate_task is a different surface. No child graph, background ownership, delegated cancellation, parallel completion or SSH parity proved. |
| Permissions / saved questions | Native extension confirmations can use actual T3 dialogs (source). Bruv saved questions are **disabled when t3NativeSession is true** in src/agent/extension.ts:542–545. No /questions bridge, resumable saved answer, human permission parity or Stop/session-work parity claim. |
| Ordinary idle input | **Actual PASS** for normal user continuation after the steered root settled. This is distinct from autonomous background output. |
| Credential containment | **No real credentials used; no child shell in actual T3 trial.** Native T3 uses different env names from ACP. src/delegation-environment.ts removes T3_MCP_URL/T3_MCP_BEARER_TOKEN for model-directed execute and shell/child environments; src/typescript/execution.ts and src/tasks/job-service.ts use that scrubber. This is **source evidence**, not a synthetic native-shell gate in this spike. The earlier same-binary ACP leak concerns T3_ACP_MCP_* names and must not be hand-waved away by native success. Before any real-credential child-shell test, require a names-only synthetic native containment test; any needed filter must remain explicitly research-only. |

## Evidence and cleanup

Repository sanitized evidence:
- evidence/native-pi-steering-summary.json — stage boundaries, hashes, counts.
- evidence/native-pi-steering-wire.ndjson — actual second-thread launch/steer/tool/settlement metadata.
- evidence/native-pi-steering-ui.json — direct gate, rendered active Steer, completed correction and idle continuation.

Owned cache retains the full sanitized recorder and controlled fixture scripts/project. One server restart happened **before** the successful steering thread, for a renewed bounded trial after browser pairing expired; no server/engine restart occurred within that steering run. Manual Playwright selector mistakes are harness failures, not provider failures. All owned processes stopped; private T3/agent/home state, pairing logs and setup screenshots removed. No parent/peer caches or processes changed. Native Pi is an **alternate feasibility result with a direct configuration blocker**, not silent abandonment of the ACP goal.
