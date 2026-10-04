# T3 → published pi-acp → compiled Bruv: filtered-launch research trial

**2026-10-03 · EXPLICITLY MODIFIED LAUNCH · RESEARCH ONLY.** This is **not** a product fix, unchanged end-to-end parity, or release acceptance. The unchanged full launch remains withheld because the earlier synthetic probe proved root T3 MCP credentials reach engine/shell children.

## Variant and safety gate

One fresh official T3 server and Chromium session, owned Git project and isolated homes, loopback deterministic Responses model fixture adapted from the successful direct Bruv probe. No paid auth, global install, rebuild, production source edits, or peer-process/cache changes. The independent task_56bfaff7 was not touched.

- Official T3 **v0.0.46-nightly.20261003.2623**, unmodified Linux binary: SHA-256 **2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795**.
- Published **pi-acp@0.0.34**, registered in the actual official catalog as **pi-acp**, using T3’s supported executable override to a byte-identical copy of its published executable. No Gemini impersonation or custom registry entry. Copied executable and original npm-tarball member both hash **324aeb8bba1228937e16b1326fb3e014e2a625b2dea549dbcd49b006cd5df6a2**.
- Same unchanged compiled **dist/bruv**, hash **5da33808892cf3c28ea9816a2e2271c183ddbcd792f7a2893483a40fcde13965**.
- **Changed launch requirement:** isolated server environment supplies **PI_ACP_PI_COMMAND=…/RESEARCH-ONLY-filtered-engine.mjs**. The Node launcher uses a child process with inherited stdio and forwarded termination signals (not a native process-image exec). It forwards engine arguments, but removes **all T3_ and T3CODE_ variables**, plus **ELECTRON_RUN_AS_NODE** and **VITE_DEV_SERVER_URL**, before starting Bruv. This includes known T3_ACP_MCP_ENDPOINT/AUTHORIZATION/NODE/ENTRYPOINT and T3_ACP_CGROUP_WRAPPER controls. It is a test shim, not upstream/product remediation. Adapter and T3 retain their private root environment; it is not a claim that their root credentials never exist.

**Gate passed before T3 launch:** synthetic endpoint/auth/node/entrypoint/cgroup/home/bootstrap/electron values were injected. Launcher evidence records **names only**; execute in actual compiled Bruv printed **ENGINE_T3_NAMES []**, and its real shell child reported **shellT3Names: [], electronPresent: false**. The actual T3 execute repeated those checks successfully; its engine launch removed **T3_ACP_MCP_AUTHORIZATION, T3_ACP_MCP_ENDPOINT, T3_ACP_MCP_NODE**, with no remaining T3 names. No actual credential was printed or copied into evidence.

T3 still supplies its MCP descriptor. Published pi-acp accepts/ignores it; **no T3 MCP tool functionality is claimed or tested**. We deliberately did not capture raw actual ACP session/new traffic or auth-bearing runtime state.

## Actual visible and persisted results

Artifacts: **.cache/acp-t3-bruv-filtered/RESULT.json**. Credential-free selected bundle: **[proof/t3-bruv-filtered](proof/t3-bruv-filtered/README.md)**. Actual Chromium 1243 rendered at 1400×950 on private loopback :18772; this is not a wire-only probe.

| Observation | Result and evidence |
|---|---|
| Execute/root completion | **PASS.** 09 rendered **EXECUTE_FINISHED_FILTERED**, restored composer, and a real execute-proof.txt file diff. Compiled Bruv wrote **UNCHANGED_COMPILED_BRUV_EXECUTE_FILTERED** and execute stdout contained **EXECUTE_REAL_BRUV_PROOF_FILTERED**. |
| Tool projection | Both execute calls persisted as completed **dynamic_tool** records with full controlled input/output, but title/toolName became generic **Tool**. 10’s expanded work section rendered that generic label. The real output and file proof exist; this is not faithful execute/job UI naming. |
| Early shell return | **PASS.** A real shell job launched with **waitSeconds:0**, **background:true**, returning before its 18-second sleep ended. T3 persisted/displayed **JOB_STARTED_RETURNING_EARLY_FILTERED** and completed run 2 at **13:28:46.616Z**. 11 captured the transition; settled/reloaded frames show the completed root answer. |
| Later completion | Shell completed and wrote late-proof.txt (**LATE_FILE_FILTERED**). At **13:29:04.906Z** the fixture received Bruv’s automatic asynchronous-task turn; Bruv persisted assistant **AUTOMATIC_LATE_COMPLETION_OBSERVED_FILTERED** at **13:29:04.911Z**. **That answer is absent from T3’s UI, marker-only browser pushes and persisted assistant messages/turn items.** 13 observed after a further 22 seconds; 15’s actual reload still omitted it. |
| Concurrent follow-up attempt | Submitted at **13:29:04.605Z**, immediately before job completion. T3 persisted the user prompt and marked run 3 **completed** at **13:29:04.985Z**, with **no assistant reply**. The fixture never received CONCURRENT_PROBE, and Bruv’s session never persisted that user prompt. The bounded 20-second visible-reply wait failed. **Not successful concurrency acceptance.** |
| Reload | **PASS for existing root transcript**, including execute/file diff, early-return answer and the unanswered follow-up. No Working/Stop remained. It did not recover the missing automatic answer. |

Read-only run/history export: three **completed** runs, three user messages, **only two** non-streaming assistant messages: EXECUTE_FINISHED_FILTERED and JOB_STARTED_RETURNING_EARLY_FILTERED. The late job’s persisted tool output remains the **initial running/background receipt**, not a later completed-job update. See projection-summary.json, bruv-session-summary.json and model-summary.ndjson together, not any single trace.

## Boundary and limitations

**The missing composition gap is reproduced safely:** Bruv completed its asynchronous work and generated a later answer; T3 showed/persisted the early root result but not that answer. The concurrent follow-up was swallowed before reaching the model yet marked completed. We did not separately isolate late-idle delivery from follow-up collision, so this is **not a uniquely established race/root-cause diagnosis**.

Read-only source context supports the boundary: nightly AcpSessionRuntime.ts ignores agent_message_chunk/agent_thought_chunk when assistantUpdatesOpenRef is closed. Published pi-acp forwards engine deltas, while its prompt error path can resolve an ordinary error and the outer ACP prompt maps that to end_turn. These are mechanisms consistent with the evidence, **not captured raw actual ACP proof of exactly which branch fired**. Full root credential logging was deliberately avoided.

One server, one browser, no restart/retry trial. Official catalog setup worked and reported the labeled instance Available. Harness-only setup error: Back was not a link; normal root navigation fixed it. The browser’s eight-minute bound expired before a final optional tool-detail expansion; that unexecuted action was removed, not reported as evidence. Stop was not tested; reload and the composition gap took priority. No real-model quality, MCP tools, crash recovery, session import/load or broad version compatibility claim.

## Cleanup

Verified both owned job exits, no owned process remaining and no :18772 listener. T3 exited with code 130 during intentional shutdown. Removed temporary T3 database/secrets/auth/runtime, engine/adapter homes and auth stores (including synthetic probe state), private pairing/server logs, and setup screenshots. Browser cookies were never saved; browser closed normally. Retained only controlled research scripts, published adapter copy, owned project/file evidence, and sanitized transcript/projection summaries. **Do not publish the whole private cache.** No production changes, rebuild, install, real-credential use, release or modification of peer caches/processes.
