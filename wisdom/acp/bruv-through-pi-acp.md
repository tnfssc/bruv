# Compiled Bruv through the published pi-acp adapter

Research only, 2026-10-03. No product/wrapper source edit, build, global install, paid authentication, production change or release. Read values and the ACP research notes. Peer native-Pi cache was only read/copied, never modified. Owned fixture state: `.cache/acp-bruv-wrapper`. All owned driver/adapter/compiled-engine processes exited; the delayed shell completed before teardown.

## Result and changed conclusion

**The actual, unchanged published pi-acp@0.0.34 works around the existing compiled Bruv for a real root conversation, tools, automatic late shell completion, cancellation, and root session load/restart.** This is not a fabricated ACP handshake, a patched Pi adapter, or a custom registry identity masquerading as another agent. The official registry entry is `pi-acp`, distribution `pi-acp@0.0.34`. Its documented engine override `PI_ACP_PI_COMMAND=<repo>/dist/bruv` selects the engine; the adapter still honestly identifies itself as pi-acp 0.0.34. Describe this as **Bruv through pi-acp**, not a registry listing of Bruv itself.

This overturns the narrower prior assumption that a newly written Bruv ACP entry is needed *before any real engine-through-ACP prototype*. There is now an existing configurable adapter to test. It does **not** establish T3 UX, own native child threads, MCP use, saved-question controls, disconnect recovery, or production replacement readiness. A dedicated Bruv implementation is not mechanically necessary for basic transport; product semantics still need deliberate implementation, either upstream adapter improvements or a Bruv-owned adapter. Prior release stays on hold.

## Exact setup and identity

- Existing compiled engine SHA-256: `5da33808892cf3c28ea9816a2e2271c183ddbcd792f7a2893483a40fcde13965`. No rebuild.
- Npm tarball SHA-1 `9121224fe418d8b9d5975798df21bd14bb84d466` matches published metadata. Extracted runtime bundle SHA-256 `324aeb8bba1228937e16b1326fb3e014e2a625b2dea549dbcd49b006cd5df6a2` matches peer's unchanged extraction. Actual wrapper runtime was the extracted `package/dist/index.js`, not rebuilt source.
- /usr/bin/node v25.9.0; runtime dependencies SDK 0.26.0, cross-spawn 7.0.6, zod 3.25.76 copied to the owned package directory from the peer's installed tree.
- Driver launched using `env -i`. Adapter spawn used an explicit environment allowlist, isolated HOME/XDG/BRUV_HOME and a shared *isolated* BRUV_CODING_AGENT_DIR/PI_CODING_AGENT_DIR. No inherited worker role, native/remote parent authority or actual provider/T3 credential. HERDR_ENV=0. The only model credential was `synthetic-local-only` for a loopback HTTP Responses fixture.
- Published spawn code sends `--mode rpc --no-themes` and adds `--session` when a session path is supplied and inherits its process environment. Existing compiled Bruv accepts these. Real Bruv creates the session file and jobs journal. The fixture chooses deterministic function calls and text; **tool execution, shell process, session persistence and automatic job delivery are real compiled Bruv behavior**.

## End-to-end observations

All 12 protocol steps succeeded (full trace and computed assertions linked below):

1. initialize requested protocol 2; actual adapter negotiated **1**, advertised load/list and HTTP/SSE MCP false.
2. session/new accepted a stdio MCP canary and returned Bruv's native session ID, local model/config choices. Canary was **not launched**.
3. session/set_config_option switched bridge to bridge-2; actual endpoint requests used bridge-2, including after restart.
4. HELLO_PROBE streamed real agent_message_chunk and returned end_turn.
5. EXECUTE_PROBE produced a real Bruv execute call; its console proof and filesystem write succeeded. ACP forwarded pending/in_progress/completed tool updates, arguments and result content.
6. LATE_PROBE launched `sleep 4; printf "LATE_SHELL_PROOF\n"` using real shell with waitSeconds:0. The execute result contained the genuine background job ID and running status; the model replied JOB_STARTED_RETURNING_EARLY and ACP prompt ID 6 returned end_turn at 1791032807962.
7. With **no new ACP prompt**, Bruv's jobs journal recorded completion/exit 0. At 1791032812376 a new root model request contained the asynchronous completion message and LATE_SHELL_PROOF output. At 1791032812379 the wrapper emitted AUTOMATIC_LATE_COMPLETION_OBSERVED as agent_message_chunk: **4.417s after the completed prompt**. It subsequently emitted usage_update and session_info_update with queueDepth:0, running:false.
8. session/list found the real stored session. A slow model request was cancelled using session/cancel; provider socket closed 4ms later and pending ACP prompt returned cancelled. This proves ordinary active-prompt/model cancellation, not whole-work/child cancellation.
9. session/load succeeded in the same process. After closing/restarting the adapter, initialize + session/load succeeded and replayed stored history/tool results. RESUME_PROBE completed; the actual provider request retained both prior function-call results, late-completion history and bridge-2. This proves root conversation continuity, not persistent execution-job resurrection.

## Existing adapter limits shown here

**MCP accepted but unused:** the exact published bundle has mcpServers at session creation/load and stores it on PiAcpSession, but does not use it to create a connection or pass it into PiRpcProcess.spawn. The stdio canary did not run. Accepting a descriptor is not MCP support. In particular, this route does not automatically expose upstream T3 delegation/tools to Bruv.

**Pi-specific tool assumptions:** the published toToolKind recognizes read/write/edit/bash; the observed Bruv execute calls become kind **other**, title **execute**, not their human label. Arguments and text output do survive. Its terminal-output special handling is only for bash. Bruv taskRows/backgroundJobs are present inside raw tool result details but are not translated into first-class ACP/T3 child/job state. No permission requests occurred in these two execute calls; no approval/question UX is claimed.

**Late text survives, lifecycle does not become a new turn:** the complete idle trace contains text, usage and running:false, but **no running:true**, no new ACP prompt response and no draft-v2 spontaneous-turn lifecycle. Published handlePiEvent's agent_start just sets inAgentLoop; startTurn emits running:true only for client prompts. Thus a client may receive the answer while still considering the agent idle. This is exactly the remaining rendered-client/Stop/attribution test; protocol forwarding alone cannot decide it. No standalone T3 UX result is asserted here.

## T3 trial deliberately not launched: concrete credential blocker

The inspected official T3 ACP path injects T3_ACP_MCP_ENDPOINT and T3_ACP_MCP_AUTHORIZATION into the agent environment. Published pi-acp spawns the engine with env:process.env. A separate **actual adapter + compiled Bruv + shell** run used only the two synthetic names/values. Model-directed execute launched `env | grep ^T3_ACP_MCP_`; the shell returned both the synthetic endpoint and authorization value. This is now end-to-end confirmation of the earlier source-level child-sanitizer mismatch, not merely a hypothetical one.

Running the real T3 path unchanged would place an actual T3 scoped bearer into Bruv's execution environment and children, contrary to this experiment's requirement. No such credential was used or copied. Fix/mediate that boundary, or establish a T3 configuration which provably omits those credentials, *before* the real pi-acp registry/T3 trial. A research shim that silently scrubs them would no longer be the requested unchanged wrapper path and would hide the product gap. The other worker owns deeper standalone-T3 lifecycle work; no competing T3 source setup was made.

## Evidence and next step

[Durable proof directory](proof/bruv-through-pi-acp/README.md): package/engine identities and registry entry, complete sanitized ACP tx/rx, local provider inputs without system instructions, real jobs spawn/completion journal, exact execute-file output, synthetic-only credential trace, drivers and computed validation summary. Absolute repo path is replaced with <repo>; no actual credentials were ever in these runs. Private scratch cache is not needed to read the proof.

After the credential boundary is resolved, use the **actual registry pi-acp** and engine override in the independently installed official T3. Test rendered idle late answer and Stop behavior first. Choose whether to contribute generic execute/lifecycle/MCP support to pi-acp or implement a Bruv-owned ACP facade based on those product semantics—not on an assumed inability to transport Bruv through the published adapter.

Values unchanged: actual-path evidence, one authority owner and credential isolation already cover these findings. Protocol-specific lessons belong here.
