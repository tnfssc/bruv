# pi-acp: maintained Pi adapter, real runtime follow-up

Research date: 2026-10-03. Scope: the closest registry peer to Bruv, not a production ACP implementation. Read alongside [direction review](direction-review.md) and [Bruv feasibility](bruv-agent-feasibility.md). **Official ACP v1 is Latest; v2 is Draft.** pi-acp negotiates v1 even when our client requests 2.

## Exact distribution and provenance

- Repository snapshot in `artifacts/acp/registry-followup.json`: official registry ID `pi-acp`, version **0.0.34**, distribution `npx.package = pi-acp@0.0.34`, repository https://github.com/svkozak/pi-acp. This is the saved registry version, not an assertion that a moving latest endpoint will retain it.
- Downloaded the actual npm tarball and ran **unmodified `package/dist/index.js`**, with locally installed package dependencies, not a fixture adapter or source rebuild. SHA-256 tarball: `4b3bf6bc71bed2b7f43dd7fcfa1906e464828e471740da593107e4f1608f2650`. npm SHA-1: `9121224fe418d8b9d5975798df21bd14bb84d466`.
- npm `gitHead` and fetched maintained main both identify **b0581c9c1d675e634234674484247008b03d69b4** (2026-09-24). All 17 bundled source-map source files match that checkout byte-for-byte. No drift between published implementation and inspected maintained source in this sample.
- Adapter Node requirement `>=20`; runtime Node **24.21.0**. Dependency `@agentclientprotocol/sdk ^0.26.0` resolved to **0.26.0**. Other runtime dependencies: cross-spawn and zod. There is **no Pi dependency bundled/pinned by this adapter**: it locates an external `pi` executable. README requires Pi **v0.81.0+** and recommends `@earendil-works/pi-coding-agent`.
- Tested underlying **@earendil-works/pi-coding-agent 1.0.0**, using already-installed assets with an isolated launch shim; npm gitHead **a13d35a742c6ef8462812a28fbe1d8c8b7431c32**. Independently downloaded its npm tarball: installed bundled CLI and upstream subagent example hash-identically to published files. This is not Bruv's agent entrypoint. See `IDENTITY.json`, `pi-npm-metadata.json` and `pi-asset-compare.txt` in the evidence cache.

## Adapter seam and authority

Maintained files below are relative to that exact repository commit:

- `src/index.ts` uses SDK `AgentSideConnection` + `ndJsonStream` on stdin/stdout; `PiAcpAgent` implements ACP methods. This is a **Pi RPC subprocess adapter**, not `createAgentSession` embedded in the ACP process. `src/pi-rpc/process.ts:159+` launches `pi --mode rpc --no-themes` (and `--session` on restore), inheriting process environment. Override: `PI_ACP_PI_COMMAND`. Extensions and prompt templates deliberately remain enabled.
- `src/acp/agent.ts:237+` advertises load, image, unstable session list/delete, no HTTP/SSE MCP; embedded context is opt-in with `PI_ACP_ENABLE_EMBEDDED_CONTEXT=true`. Protocol-version negotiation returns 1.
- Authentication is discovery plus out-of-band terminal launch. Initialize advertises `pi_terminal_login`, `type: terminal` and `--terminal-login`, with Zed terminal-auth metadata when the client advertises it. **ACP authenticate itself is a successful no-op**; it does not sign in. Actual terminal-login would launch interactive Pi; we did not invoke it.
- **ACP-injected MCP is accepted but not consumed.** `agent.ts:280+` explicitly says Pi does not support `mcpServers`; `session.ts` holds the supplied array, but launch does not forward or instantiate it. Session-map persistence holds cwd/session-file only, not these server definitions. README suggests a separately installed Pi MCP extension, not automatic ACP host-server injection. Do not mistake default stdio MCP capability for proof of this seam.
- No ACP filesystem or terminal delegation: Pi reads/writes/executes locally, regardless of advertised client FS/terminal support. Builtin tools do **not** automatically request ACP permission. Extension `ctx.ui.confirm` and `ctx.ui.select` are translated to `session/request_permission`, not a general tool security gate. Input/editor UI requests are cancelled with a visible message; notify becomes assistant output. This translation is useful, but is neither Bruv's durable saved-question service nor human-owned capability policy.
- Model config bridges Pi `get_available_models/get_state/set_model`. ACP config options expose provider/model IDs and thinking level; legacy models/modes are also returned. Modes mean **thinking levels**, not plan/build permissions. This sample's local models were non-reasoning; requesting high returned success but effective thinking remained off. We proved model switching, not real-provider reasoning/auth switching.
- `session.ts:540+, 865+` keeps a normal ACP prompt open until Pi **agent_settled**, not the first agent_end; flushes updates/context usage before resolving. This preserves queued Pi continuations within a known prompt. Adapter FIFO queues competing ACP prompts while `pendingTurn` exists; cancel aborts current Pi work and clears that queue.
- README's statement that there is no separate thought stream is stale relative to `session.ts:598+`, which maps thinking_delta to agent_thought_chunk. We did not exercise genuine thinking output.

## Real published runtime results

Evidence owned at **.cache/acp-pi-peer/**. Four executable probes use raw ACP JSON-RPC over stdio against the real npm adapter. Only the **model HTTP service** is deterministic synthetic OpenAI-compatible SSE on loopback; the UI/late-event extension is explicitly a small research extension. There are no paid-provider calls/sign-ins in these probes. Each launch builds an environment whitelist with isolated HOME, XDG directories and PI_CODING_AGENT_DIR: **no inherited provider tokens or user's Pi config**. No actual credentials were copied into caches; the only key configured is `dummy-local-only`.

| Path | Actual observation | Proof |
| --- | --- | --- |
| Initialize/auth discovery | Requesting protocol 2 returns 1 with adapter version 0.0.34 and terminal auth method | RESULT.json, trace.ndjson |
| Fresh unauthenticated HOME | authenticate succeeds as no-op; session/new still errors -32000 Authentication required, including auth methods | same; expected blocked case, not sign-in |
| Safe local setup | Pi models.json loopback endpoint + dummy key makes session/new work; two local models/config options advertised | driver.mjs; RESULT.json |
| Model/config | set_config_option selects local-research/peer-local-2; subsequent actual HTTP requests use peer-local-2 | trace.ndjson model-request records |
| Text + tool execution | Real Pi consumes fake SSE tool calls, reads sample.txt, writes written.txt, returns tool output and ACP tool events, completes end_turn | RESULT.json; written.txt; trace.ndjson |
| Host permission boundary | Despite client fs/terminal support, read/write execute locally with **zero** permission/fs/terminal requests | trace.ndjson |
| MCP injection | Valid stdio canary accepted in session/new; canary process never launched and its tool never appears | driver.mjs, RESULT.json mcpLaunched=false; source confirms why |
| Session/config/stats/list | /session works; list finds session by its Pi identity; usage updates emitted | RESULT.json |
| Resume | session/load replays user/assistant/tool history; a fresh adapter process with same isolated HOME loads same session ID and model, then completes another real local-model prompt | RESULT.json and trace.ndjson restart records; HOME/.pi/pi-acp/session-map.json |
| Root cancel | Delay model response, send session/cancel; end_turn is not returned, cancelled is; HTTP stream closes | RESULT.json and model-cancelled records |
| Extension UI | Real loaded Pi extension confirm/select produce two ACP permission requests; deterministic **test-driver** choices yield true/alpha; input is unsupported and cancelled, notify visible | extension-probe.ts, RESULT-ext.json, trace-ext.ndjson, home-ext/extension-proof.ndjson |
| Upstream subagent extension | Unmodified Pi-distributed subagent example executes an actual child Pi process/model call with Task: CHILD_LOCAL_ONLY; result returns through parent's ordinary subagent tool; parent completes | subagent-driver.mjs, RESULT-subagent.json, trace-subagent.ndjson |
| Subagent cancel | Parent ACP cancel while real child is waiting on local endpoint produces cancelled + failed subagent result; child HTTP connection closes | same; /proc sample: child PID 3606347 exited, parent Pi PID 3606230 remained (RESULT-subagent.json) |

The upstream subagent example is **optional Pi extension functionality**, not a pi-acp advertised child-session capability. It implements synchronous single/parallel/chain dispatch, independent context, streamed tool details and signal-linked child cancellation. pi-acp sees an ordinary tool called subagent (kind other), not a native ACP child graph, stable resumable jobs, nested task ownership or background completion service. Only single success and active-child cancel were run; parallel/nested graph behavior was not claimed.

## Important actual post-prompt result: late output works, ownership does not

The research extension waits **700 ms after agent_end** and then calls real Pi `sendUserMessage`. We waited for the originating ACP prompt to return end_turn first. Pi starts a new real provider run without another client session/prompt; pi-acp forwards its text as session/update.

In `trace-ext.ndjson`, prompt response ID 7 completes at **1791032286151 ms**; the subsequent local-model request is at **1791032286856 ms** and LATE_REPLY_FROM_MODEL is emitted at **1791032286858 ms**. This proves **maintained-adapter late notifications are possible**, not client acceptance or complete run lifecycle. There is no new ACP prompt owner/response, child session, draft-v2 state_update or corresponding late running=true metadata. Normal final running=false metadata is emitted even with no pending prompt. A client that ignores/settles post-prompt updates can still lose the experience; this does not overturn the exact generic-registry T3 finding in direction-review.

We then held that unsolicited late provider call open and submitted user input:

- Real Pi RPC rejects `USER_INPUT_DURING_LATE`: **Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.**
- pi-acp submits no streamingBehavior and only queues ACP input while it owns a pending prompt. That background run has none. Its non-auth prompt-error path converts this rejection into **ACP end_turn**, rather than an error or queued input.
- The driver receives end_turn almost immediately; there is no provider request for that user input and no replayed user message on load. **A user prompt is silently dropped in this tested late-run race.** Source: `session.ts:552+` and `agent.ts:798+`; exact unmodified Pi RPC request/error: `pi-rpc-race.ndjson`. The extra wrapper only logs and passes through to the same real Pi executable; it is not a substitute agent.
- Sending ACP cancel during a second unsolicited run **does abort** the local model connection (11 ms after the final instrumented notification). There is no outstanding ACP prompt response to mark cancelled, and this is not a browser Stop-state proof.

Thus pi-acp is helpful evidence for transport and Pi extension compatibility, **not a solved Bruv async-root contract**. It exhibits exactly the run ownership/input-race gap worth preserving in Bruv's proposed acceptance test.

## What Bruv could reuse vs must still own

**Reusable:** SDK stdio setup/validation, event/content/tool/diff translations, config-option/model menus, terminal-auth discovery conventions, full-history replay and Pi identity mapping, extension confirm/select bridge, context usage, and settling on authoritative engine-idle rather than a low-level agent_end. MIT code is inspectable and source-matched. Bruv already embeds Pi's SDK; adopting this subprocess architecture is not required to reuse these patterns.

**Still custom:** Bruv's composition/session boundary; roles/depth/profiles and root ownership; SSH/current-runtime placement and workspaces; job identities, async attention and post-handoff root wake; queue/input-race policy; whole-work vs foreground vs subtree Stop and acknowledged process exit; durable questions with human-owned answers; client MCP injection/credential isolation and tool mediation; recovery/reopen semantics for running work; honest client task visibility. Pi extensions being loaded does not transfer any of these responsibilities to ACP/T3. Unmodified pi-acp would run ordinary Pi, not Bruv's tools or task system.

## Reproduce / limits

Commands and all probe source/proof are under the owned ignored cache; see README.md there. Run scripts **sequentially**, as each writes a common launch shim. Each resets only its own named home/work fixture; do not point HOME at user data. Dependency install was local to package with ignore-scripts; no global install, product source edit, build overwrite or release. Runtime adapter/Pi versions and endpoint are pinned in evidence, not merely readiness inferred from source.

Not exercised: real API/OAuth sign-in, paid providers, image/audio/embedded-context runtime, HTTP/SSE MCP, a separately installed MCP extension, browser/editor integration, backend restart with live jobs, session/delete, persistent permission recovery, nested/parallel subagent graphs, or Bruv extension loaded inside this adapter. No claim of production ACP parity. After reading existing values, **values unchanged**: one-owner, actual-path evidence, honest limits and safe-resume guidance already cover these findings; the protocol-specific additions belong in this note.
