# Unmodified T3 nightly: deeper ACP runtime probes

**Observed 2026-10-03, 12:55–13:15 UTC.** Follow-up to [the upstream experience](t3-upstream-experience.md) and its clean response/next/Stop/browser-reload acceptance. This is a bounded **research fixture** experiment, not Bruv ACP acceptance, Gemini acceptance, a maintained adapter test, or a replacement recommendation.

## Runtime and isolation

- Exact official executable: **.cache/acp-t3-upstream-experience/platform/t3**, **t3 v0.0.46-nightly.20261003.2623**. Source snapshot: **fed41fa88bb27cb4325cb208d571393850bc63c2**.
- SHA-256 before/after: **2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795**. No upstream/product patches, package rebuild, build overwrite, or release.
- Own artifacts: **.cache/acp-t3-deep-probes/**. Independent Git project, base-dir and OS home; project base commit **07162344f9c4e723ddb95c2484a4af1e1b18d4e0**. Loopback **:18766**, server launched with `env -i` and only PATH/HOME/XDG_CONFIG_HOME supplied. No parent provider credentials or bundled-provider auth discovery from the real home. Fixture advertises no sign-in and makes no external provider calls. No provider credential was used, mock or real.
- Fresh headless Chromium context (1400×950), no imported cookies. Existing Playwright/Chromium reused only as tooling. Registered through real Settings UI: official registry ID **gemini**, executable override **fixture.mjs**, instance **deep-research-fixture**, label **Deep Research ACP Fixture (not Bruv)**. Registry supplies `--acp`; fixture ignores it. This is **not** legitimate Bruv registry registration.
- Only real capability credential: T3's per-session injected MCP bearer. Used through its supplied process environment/private runtime state; retained descriptor authorization values are redacted. Pairing URL/browser storage were private and removed.

## Results at a glance

| Probe | Actual result / qualification |
|---|---|
| Generic v1 prompt settles, then late text/tool/state | Frames reached ACP wire, but were not rendered/persisted as owned work. **No continuation run.** Tool was already locally completed at prompt settlement. |
| V2-shaped initialization accepted → running → delayed text → idle | UI **Working**, projection **running** after acceptance; delayed text rendered and same run completed only after idle. |
| Injected MCP offered versus consumed | Supplied bridge launched; **initialize**, **tools/list (70 tools)**, successful read-only **t3_thread_configuration** call through T3's injected bearer. |
| Permission / form UI | Supervised mock edit **Approve/Decline** returned matching answers. Form **Submit** accepted; **Stop generation** cancelled second form/interrupted run. No edit performed. |
| Agent process crash | Owned fixture SIGKILL; next prompt recreated it and **session/load** restored same native ID. Rendered completion passed. |
| Backend process restart | Actual listener terminated, port closed, different backend PID started with retained isolated state. After browser reload: **session/load**, same native ID, retained transcript and new rendered completion. Not just browser reload. |
| Model selection | Legacy models-only advertisement/custom picker slug changed selected/displayed model but sent **no setter**. Category:model **configOptions** caused real **session/set_config_option**, B then A, matching UI. |

## 1. Post-settle traffic is not owned continuation work

Evidence: **08-result.json / screenshot**, **late-projection.json**, **protocol-summary.json**, **projection-summary.json**.

Fixture PID 3571566, native session `2fbc1d32-ae9f-42c9-b6cb-617dd1b610b1`:

- 13:00:21: start text, read-only tool `in_progress`, `DEEP_EARLY_COMPLETE`, prompt result `{stopReason:"end_turn"}`.
- Run 1 completed immediately. Tool item/node completed locally at **13:00:21.018**, before its actual completion frame.
- About **3.5s later**, wire emitted `DEEP_LATE_TEXT`, tool-call update `completed` with `DEEP_LATE_TOOL_COMPLETE`, and `state_update:running`; idle followed ~1.8s later.
- UI showed early completion, no Working/Stop after settling. Snapshot: **one completed run**, non-streaming early assistant messages, provider thread **idle**, **no late text/tool output**. Later replay/recovery also did not create late owned messages or late-output tool items. Final count: 13 deliberate user-prompt runs, no extra continuation run.

This does not mean generic ACP cannot stream tools during an active prompt. It means this **post-terminal v1** traffic is not automatically new owned work. Running/idle was deliberately tested as compatibility traffic: v1 Latest does not acquire v2 lifecycle semantics by sending state after an end-turn result.

Source comparison, **not a Grok runtime assertion**: `AcpAdapterV2.ts:413–422` describes post-settle buffering/provider-continuation; `GrokAdapterV2.ts:327` enables `enablePostSettleContinuation: true`. Generic `AcpRegistryAdapterV2` does not opt in. Only Grok enables it among production adapters in this snapshot. Grok also has background-finalization/wake policy absent here. Other workers own maintained-adapter evidence; this fixture did not test Grok's path.

## 2. Offered MCP was actually consumed

Evidence: sanitized **fixture-protocol.ndjson**, **protocol-summary.json**, **09-result.json / screenshot**.

Provider status/test session received **mcpServers: []**. Real conversation received:

```json
{"name":"t3-code","command":"<official-platform-t3>","args":["acp-mcp-bridge"],"env":[{"name":"ELECTRON_RUN_AS_NODE","value":"1"},{"name":"T3_ACP_MCP_ENDPOINT","value":"http://127.0.0.1:18766/mcp"},{"name":"T3_ACP_MCP_AUTHORIZATION","value":"[REDACTED]"}]}
```

Fixture spawned **that supplied command/args/env**, not a mock/replacement MCP server. At **13:00:21.275**, MCP initialize returned protocol **2025-06-18** and server info; tools/list followed. Inspected offered schema/readOnlyHint before writing **mcp-call.json**:

```json
{"name":"t3_thread_configuration","arguments":{}}
```

At **13:00:54.550**, tools/call returned **isError:false**, text and structuredContent:

```json
{"threadId":"898cc9fa-610f-4f7f-8050-758328735797","modelSelection":{"instanceId":"deep-research-fixture","model":"default"},"runtimeMode":"full-access","interactionMode":"default"}
```

This proves authenticated thread-scoped **read-only consumption**, not merely offering. No launch/mutation/shell/paid delegation attempted. The actual descriptor was stdio; fixture http/sse declarations did not make T3 inject HTTP descriptors. V2-shaped initialization later added `type:"stdio"` to the same bridge descriptor.

**Fixture qualification:** early follow-up extraction concatenated T3's appended instructions; broad `includes("MCP")` consequently repeated this same safe read-only call during some approval/form prompts, and echoed instructions into synthetic transcript. Corrected extraction before crash/restart probes to trim at `<runtime_info>`. These are fixture defects, not T3 failures or extra autonomous capability use. First explicit MCP prompt/call remains independently evidenced.

## 3. Real permission and form UI

Evidence: **11–15-result.json / screenshots**, **requests-projection.json**, **final-projection.json**, summarized wire responses.

Changed Full access → **Supervised**. Mode change re-created fixture and **session/load** restored existing conversation. Synthetic `session/request_permission` described an edit with allow_once/reject_once choices; fixture never implemented a write.

- UI **File change approval / Changed files / Approve / Decline**; composer replaced by “Resolve this approval request to continue”. **Approve** returned `{"outcome":{"outcome":"selected","optionId":"allow-once"}}`.
- `elicitation/create` with `mode:"form"`, required string enum and Preference label rendered **Input requested**, **Strict schema / Flexible UI**, custom-answer field and **Submit**. Selected Strict schema; wire: `{"action":"accept","content":{"preference":"Strict schema"}}`.
- Second form cancelled by actual **Stop generation**, not an invented form-specific Cancel button. Wire **action:cancel**, then `session/cancel`; prompt result **cancelled**. UI “Run interrupted · Run interrupted by user”. Projection run 5 **interrupted**, user-input request **cancelled**. Subsequent prompt accepted.
- Next mock edit **Decline** returned selected **reject-once**. Other three request projections **resolved**.
- Target **project/NEVER_WRITTEN.txt** verified absent at cleanup.

No arbitrary schema acceptance, URL elicitation, permission timeout, active-request backend-crash recovery, or destructive operation is claimed.

## 4. Real process/backend restart, load and resume

**Agent crash:** SIGKILL fixture **3580877** while idle. Next prompt created **3598164**, then **session/load** with original native ID/new injected descriptor. **16-result.json** rendered `DEEP_START AFTER_AGENT_CRASH ... DEEP_COMPLETE`; provider-thread binding retained. Fixture owns tiny persistent synthetic history for this test. Not proof arbitrary agents actually persist loadable history.

**Backend restart:** actual listener **3538038** got SIGTERM at **13:04:56**; :18766 unbound, fixture/bridge children disappeared. New official listener **3610086** started **13:05:23**, same isolated home/project. Browser visibly reconnected; first Enter during reconnect left text **unsent**. After bounded wait, reconnect indicator disappeared but text remained draft. One reload, then a fresh prompt. **22-result.json / screenshot** shows retained transcript plus `DEEP_START VERIFIED_BACKEND_RESTART_AFTER_RELOAD ... DEEP_COMPLETE`. Wire **13:06:11.071**: fixture **3616067**, **session/load**, original native ID. Persisted restored completion appears once, not duplicated by synthetic replay. See **backend-restart-projection.json**.

Harness failure retained: first killed shell/job **3537986**, not child listener. Restart attempt hit **EADDRINUSE**. **17/18** and misleading **AFTER_BACKEND_RESTART** marker are **not restart evidence**. Found surviving listener, terminated explicitly, checked closed port; **19–22** are verified restart. SIGTERM/130 exit statuses are deliberate teardown, not failed ACP turns.

Seamless reconnect-and-submit success is not claimed; verified recovery uses reload **after real backend restart**. No running-work crash/auto-continue test.

**Draft resume:** v2-shaped respawn issued real **session/resume** at **13:11:53.872**, `replayFrom:{type:"start"}`, original native ID and typed stdio descriptor. T3 converts internal load to v2 resume/replay; source `effect-acp/src/client.ts` documents mapping. Actual resume wire evidence, not just advertisement. Native session list/import UI remains untested.

## 5. Version/model qualifications: normalized support ≠ standards maturity

Official pages fetched during run still label **v1 Latest**, **v2 Draft**: **official-version-labels.json**, HTTP 200. V2 prompt response is acceptance, not completion: [draft prompt lifecycle](https://agentclientprotocol.com/protocol/v2/draft/prompt-lifecycle). This is a dated observation; draft can change.

Two separate experiments:

1. **Wrong generation signal:** numeric **protocolVersion:2**, legacy **agentInfo/agentCapabilities** shape. T3 treated as v1: **session/load**, immediately completed run 11, delayed text not rendered. **Fixture shape error**, not full v2 conformance failure. Source `client.ts:1126` notes shipped v1 agents reporting numeric 2; `isV2InitializeResponse` discriminates on **info**, not integer alone.
2. **V2-shaped initialization:** `{protocolVersion:2,info:{...},capabilities:{session:{mcp:{stdio:{}}}},authMethods:[]}`. Sent `state_update:running`, immediate prompt result **{}**, waited **4.5s**, text `DEEP_V2_DELAYED_TEXT_COMPLETE`, then `state_update:idle,stopReason:end_turn`. **29/32 screenshots** Working/Thinking; **30/33** text and idle composer. **v2-active-projection.json**: run 13 **running**, completedAt null. **final-projection.json**: **same run** completed at idle, assistant non-streaming. Run 12 similarly completed ~4.5s after acceptance. **Neither is post-settle continuation:** owned run never ended at acceptance.

Model behavior also shape-dependent:

- V1 legacy `models` A/B advertisement did not populate discovered list (only Default initially). Added custom slug **research-b**, selected/prompted. Picker and injected runtime instructions said research-b; **no session/set_model or set_config_option**. Not actual model switching. Source `AcpAdapterV2.ts:6126–6133` gates generic application on category:model **configOptions**.
- V2-shaped initialization offered that option. Resume actually sent `session/set_config_option {configId:"model",type:"id",value:"research-b"}`; selecting Research A sent **research-a**. Fixture acknowledged full updated configOptions; UI **Research B → Research A** agrees (**29–33**). Config plumbing/application proof, not provider inference.

These observations prove functioning **normalized draft-v2 support** in T3. They do not make v2 stable/latest, prove all methods, or validate all agents announcing numeric 2.

## Exact commands / evidence recipe

From repository root. Existing official archive/tooling reused read-only; new mutable state owned by this directory:

```sh
R="$PWD/.cache/acp-t3-deep-probes"
B="$PWD/.cache/acp-t3-upstream-experience/platform/t3"
mkdir -p "$R"/{project,home,os-home,private}
chmod 700 "$R"/{home,os-home,private}
printf '# Deep ACP research fixture project\n' > "$R/project/README.md"
git -C "$R/project" init -q
git -C "$R/project" -c user.name=Research -c user.email=research@example.invalid add README.md
git -C "$R/project" -c user.name=Research -c user.email=research@example.invalid commit -qm base
sha256sum "$B" > "$R/binary-sha256.txt"
"$B" --version > "$R/version.txt"
chmod +x "$R/fixture.mjs"
node --check "$R/fixture.mjs"
(cd "$R/project" && env -i PATH=/usr/local/bin:/usr/bin:/bin \
  HOME="$R/os-home" XDG_CONFIG_HOME="$R/os-home/.config" \
  "$B" start --host 127.0.0.1 --port 18766 --no-browser \
  --base-dir "$R/home" --auto-bootstrap-project-from-cwd \
  > "$R/private/server.log" 2>&1)
# Concurrently, not after foreground server exits:
node "$R/browser.mjs" > "$R/private/browser-harness.log" 2>&1
# Harness privately reads pairing URL, executes numbered actions as they appear.
# Numbered action/result records 01–34 retained; historical screenshots were retired (see [protocol artifact retirement](../quality/protocol-artifact-retirement.md)). Actual-run crash/restart commands:
kill -KILL 3580877
ss -ltnp 'sport = :18766'  # identify ACTUAL listener, not shell/job wrapper
kill -TERM 3538038
# Verify closed port, repeat server launch with same home/project and
# private/server-restart-verified.log. New listener: 3610086.
python3 "$R/projections.py" "$R/backend-restart-projection.json"
# Later fixture-only draft branch + respawns. Historical PIDs, NOT reusable:
printf 'Research only: explicitly probe normalized Draft protocol v2' > "$R/v2-enable"
kill -KILL 3616067  # numeric-2 legacy-shape phase
kill -KILL 3638471  # v2 info/capabilities phase
# Final teardown after browser-stop action:
kill -TERM 3610086
```

Final **fixture.mjs** contains corrected v2 initialization branch (prompt ACK still lacks required messageId); integer-2/legacy-shape attempt remains in wire/results, not final branch. Initial syntax escaping corrected before successful negotiation. Preserve phases when replaying; **never execute historical PIDs on a new run**. Fixture selects version by **v2-enable**, which must be absent for initial v1 phase. Browser actions are exact UI automation, including custom-model locator `#provider-instance-deep-research-fixture-custom-model`.

Wrong exact-name Refresh and Providers-link selectors each timed out once; corrected button match/direct settings URL. Initial “No valid cached ACP Registry index” cleared with one real refresh after cache population. No indefinite setup/install loop.

Readable evidence: **protocol-summary.json**, **projection-summary.json**, **source-proof.txt**, **server-evidence.log**, **cleanup.json**. Larger sanitized wire/browser frames/projections stay local. Claims use wire/projection corroboration, not screenshot caption or fixture marker alone.

## Cleanup / remaining limits

Browser exited 0; actual backend shut down; no :18766 listener, owned fixture/browser, or mock write target. Removed T3 SQLite/auth/signing/runtime state, isolated OS home, fixture persisted sessions, browser cookies/storage, private logs/pairing secrets, setup screenshot/text. Retained redacted traces/synthetic projections only. Official binary checksum unchanged. **Do not publish cache wholesale.**

No browser page exception. Residual Clerk 400/domain-origin errors, observability trace aborts, no-remote-project PR lookup warnings retained. They did not prevent bounded flows; not attributed to ACP without evidence.

Remaining: maintained Bruv/paid-agent acceptance, legitimate registration, Grok continuation runtime, active-run backend crash/auto-resume, native list/import UI, wider permission/form schemas, file/terminal/media, URL elicitation, MCP mutations/subagent ownership, stable-client parity. Other workers own maintained adapters/registry governance. **Concrete generic gap: terminal-v1 post-settle ownership, not canonical-v2 acceptance-to-idle streaming.**

## Parent protocol-shape correction

The fixture entered T3’s v2-shaped initialization path and demonstrated run lifetime controlled by running/idle, but its immediate prompt response was {}. Parent independently checked official schema/v2/schema.json and schema.unstable.json at937d3146: PromptResponse requires a non-null messageId, with a matching live user-message echo. Therefore this is evidence of T3’s accepted normalized lifecycle path, NOT canonical/current-draft-v2 conformance. Do not recommend an empty ACK in a Bruv implementation. Numeric version alone was insufficient; the corrected info/capabilities shape mattered, but does not erase this response-shape gap. No spontaneous post-idle v2 continuation was tested.
