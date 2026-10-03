# T3 generic ACP Steer/Stop wire contract

2026-10-03. Research only: unchanged official T3, labeled ACP mock, read-only source inspection and deterministic native Pi engine probe. No production edits, real-provider calls, changes to other workers, or release. Read [steering requirement](steering-requirement.md), values, prior research, and the newly available [pi-acp-only options review](pi-acp-only-options.md).

## Finding

**Rendered T3 Steer exists and does more than Queue. Generic registry ACP translates it into cancellation plus replacement prompt, not continuing Pi steering. At cancellation time Steer and Stop produce exactly the same ACP envelope.** No reason, intent, text or distinguishing metadata is forwarded. This is actual wire evidence, not inference from a method name.

A pi-acp-only implementation cannot choose “retain the active Pi/tool loop and inject streamingBehavior:steer” for Steer while choosing honest foreground cancellation for Stop from this identical input. A later prompt means new input; it cannot undo cancellation or retroactively distinguish Steer from Stop followed by a new message. Timeout detection, swallowing cancel, or declaring cancellation while secretly continuing the root are not solutions.

**Interrupt/restart is a real but narrower adapter-only option.** It can retain the native session and continue corrected work. Active foreground-tool preservation, child preservation, queued-input preservation and honest Stop still need separate proof. User acceptance of relaxed semantics must be explicit.

## Actual unchanged UI and wire

Official T3 `0.0.46-nightly.20261003.2623`; binary SHA-256 `2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795`. Matching unmodified source snapshot `fed41fa88bb27cb4325cb208d571393850bc63c2`.

Owned scratch `.cache/acp-steering-wire`, loopback port **18788**, isolated data/OS HOME and sanitized launch environment. Parent binary, public registry cache and Playwright/setup recipes reused read-only; no parent processes/state reused. Provider `steering-wire-fixture`, driver `acpRegistry`, registry ID **gemini**, executable override **Steering Wire Research Fixture (not Bruv/Pi)**. Deliberately not a Gemini, pi-acp or Bruv product trial. Source confirms pi-acp uses this same generic flavor with no pi-specific cancellation exception. ACP v1 models published pi-acp’s blocking prompt contract; no new v2-conformance claim.

Fixture holds a prompt with a conspicuously labeled **simulated** in-progress tool, then honestly reports cancelled on cancel. No actual tool/provider credentials. Actual browser path:

1. Submit `WIRE_LONG_STEER_1`; wait for rendered active work.
2. Enter `WIRE_CORRECTION_STEER_1`, click **Queue message**, then its rendered **Steer** button.
3. After corrected reply, submit separate `WIRE_LONG_STOP_1`.
4. Queue `WIRE_QUEUE_RETAIN_1`, then click **Stop generation**.

Browser → T3 commands distinguish intent:
- Steer: `queued-message.promote-to-steer` with queuedRunId/targetRunId.
- Stop: `run.interrupt` with runId and `holdQueue:true`.

But both produce this **exact same ACP message**:
```json
{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"f49a623d-59bd-4d5d-a380-f02cf5f132e0"}}
```

Neither cancel has `_meta`, reason, trace/span, target run or replacement text. Subsequent Steer prompt contains correction as ordinary text plus normal T3 runtime instructions; no steering/delivery-mode marker. Queue click alone sent **no ACP prompt** during active work.

UTC wire times: initial prompt **14:09:19.011**; Steer cancel **14:10:28.311**; mock cancelled response **14:10:28.343**; replacement prompt/corrected completion **14:10:28.730**. Separate Stop cancel **14:11:47.023**. Response ordering is the mock’s behavior, **not** proof T3 waits for real Pi idle: source shows generic cancellation interrupts its local prompt fiber first.

### Retained IDs and queue

Native session `f49a623d-59bd-4d5d-a380-f02cf5f132e0` and fixture PID **4032218** remained across Steer and Stop. **No generic process-group kill observed.** This does not prove real child preservation.

T3 thread `142afc2d-8a7c-4757-89d9-f2e721ae2ac1`:
- Run `run:thread:<thread>:ordinal:1` retained across Steer. Attempt 1 **superseded**; attempt 2 **completed**. Native/provider turn changes turn:1 → turn:2 and root-node attempt changes: replacement ownership under same run, not unchanged active-turn ownership.
- Correction’s previous queued run ordinal:2 becomes **cancelled** on promotion; its text retained in replacement attempt.
- Separate Stop run ordinal:3 **interrupted**, no automatic replacement prompt.
- Independently queued run ordinal:4 stays **queued**, text retained after Stop. T3’s own queue is not lost in this capture.
- Same T3 provider-session/provider-thread IDs retained; session **ready**, provider-thread **idle** afterward.

UI snapshots briefly lag the wire. Settled `09-*` evidence shows **Run interrupted by user** and retained queued row. Earlier UI snapshots are not engine-idle proof.

## Exact source reconciliation

Paths relative to pinned official source:
- `apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.ts:548–563`: active-steering false, interrupt/restart true, Queue true; `:7290–7296`: direct steerTurn unsupported.
- `Adapters/AcpRegistryAdapterV2.ts:140–178,187–235`: actual generic runtime/flavor; no cancelMeta, wait-for-prompt or pi-acp active-steer mapping. Named exceptions are other agents.
- `CommandPolicy.ts:249–268`, `Orchestrator.ts:3655 onward,3953–3974`: selects interrupt/restart, persists steering_restart attempt.
- `ProviderTurnControlService.ts:172–187`: Stop supplies **internal** requestRuntimeRestart:true; `:200–223`: steering restart interrupts without that flag. **Not forwarded as ACP metadata.**
- `provider/acp/AcpSessionRuntime.ts:2431–2447`: payload sessionId plus optional **configured** cancelMeta. Generic path interrupts prompt fiber, writes cancel; fixed cancelMeta would decorate both operations identically.
- `AcpAdapterV2.ts:7325–7340,7498–7550`: hard process-group termination and settled/background soft-preservation require flavor flags. Stop’s internal restart flag alone is not a generic hard kill.

Hold-open or numeric protocol-v2 switching does not change this dispatch policy. Detailed outstanding-prompt and background-delivery ownership constraints belong to [pi-acp-only options](pi-acp-only-options.md). This report adds actual wire proof, not a competing implementation.

## CLI native engine contract at tool boundaries

Installed Bruv engine: `@earendil-works/pi-coding-agent@1.0.0`, `pi-agent-core@1.0.0`. Interactive mode `dist/modes/interactive/interactive-mode.js:2664–2672` sends input while streaming via `session.prompt(text,{streamingBehavior:"steer"})`. `agent-session.js:1515–1525,1680–1710` queues agent.steer without abort. `agent-loop.js:155–190` awaits current tool batch/results, emits boundary, obtains steering messages before next model request. Does not retroactively rewrite or cancel already-running shell/tool work. Default Agent tool execution is parallel; sequential execution likewise does not inject changes into the executing tool itself.

**Deterministic real Agent-core probe, mock streaming and tools only:** model issues two tools; during long mock t1, enqueue correction plus distinct follow-up. Both tools complete with signalAborted:false and no abort event. Next request includes correction, not follow-up; following request includes retained follow-up. Single active Agent owner. See `native-boundary.json` and executable probe. This exercises installed engine loop, not paid provider, interactive UI or real Bruv shell/job survival.

Published pi-acp source commit `b0581c9c1d675e634234674484247008b03d69b4`: `src/acp/agent.ts:903–907` forwards cancel; `session.ts:396–415` **clears its own ACP FIFO** then calls Pi abort. `src/pi-rpc/process.ts:259–267` sends ordinary prompt without streamingBehavior and abort separately. Pi `agent-session.js:1873–1884` aborts active signal and awaits idle. Adding steer to the wrapper is straightforward; unchanged generic T3 does not supply that non-cancelling input. T3 queue preservation observed above does not prove adapter FIFO or volatile engine-queue preservation.

## Concrete adapter-only choices

### A. Honest interrupt/restart — feasible direction, relaxed semantics

Keep one Bruv engine/native session. Actually interrupt foreground on cancel, fence cancelled generation, admit replacement only after authoritative idle/quiescence. Preserve accepted input with explicit attribution rather than pi-acp blanket FIFO clear. Reuse Bruv job owner; no second executor.

T3 Steer can then continue corrected reasoning after interruption. Detached/background jobs may survive foreground abort, but active execute/tool stack can be interrupted: **not native-steer parity**. Need parent-delivery pause/reattach so automatic completions cannot secretly start root after Stop ended the ACP request. Other reviewer identifies minimal Bruv API seam; hold-open prototype alone is insufficient proof.

Foreground-only Stop must be an explicit accepted contract. Mapping generic cancel to Stop-all would cancel children on **Steer too**. Same cancel cannot implement different foreground/session-work scopes based on UI intent.

### B. Durable work plus restart at a safe boundary — narrower potential

If real work was already handed off to Bruv-owned background jobs and foreground reached an interrupt-safe boundary, restarting may preserve those jobs and correct later reasoning. Must prove completion/input delivery, no automatic post-Stop root turn, no duplicates and honest UI. Does not preserve arbitrary active foreground tools; a replacement into stopped engine is not streamingBehavior:steer. User may accept preserved-work semantics; do not assume that choice.

### C. Genuine active steering for capable clients — adapter possible, not this path

Add explicit active-input RPC/extension or delivery-mode metadata; map it to Pi steer separately from follow-up and cancellation. A capable client could use the demonstrated boundary. Generic unchanged T3 neither calls it nor forwards intent. Agent capability advertisement alone cannot change static T3 policy.

### D. Requirement unchanged — exact missing contract

Need **Steer plus correction text without first requiring foreground cancellation**, separate from honest Stop/scope. A cancel reason alone at least removes ambiguity, but continuing-loop steering also needs correct run ownership and settlement. Current official generic dispatch cannot provide rendered Steer → continuing Pi steer with active-tool behavior and honest Stop by pi-acp-only changes.

No T3 edit permission inferred. Alternative forms/slash commands, private SQLite/event-journal scraping or covert websocket control are not supported proof of the required rendered Steer path. Browser command capture pinpoints where information exists **before** translation; ACP connection loses it. Offered MCP queue-read tools are not an atomic active-cancel intent channel.

## Evidence and cleanup

Durable sanitized evidence: [proof/steering-wire](proof/steering-wire/README.md): UI envelopes, ACP wire, retained projection IDs/statuses, screenshots, identities/hash, native boundary probe. Runtime instruction blocks explicitly omitted with length/hash; message envelope fields and correction retained. Host bearer/machine paths removed. Initial harness wrong selector recorded separately, not a steering failure.

Owned browser exited normally; owned server stopped, listener 18788 closed, fixture exited. Isolated auth/browser/database state removed after extraction. Parent source/binary/recipes and other workers untouched. No release.
