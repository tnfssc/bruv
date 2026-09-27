# Production SSH remote tasks (2026-09-27)

## Work and scope

Integration branch: `die/production-remote-ssh-first-usable-slice-592a70dc`.
Lasting worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_592a70dc`.
Workers (all under `/home/tnfssc/.die/worktrees/`):
- Owner/protocol: `die-a86675007a5e-task_592a70dc-a86675007a5e-task_5e4f0e87`, branch `die/production-remote-protocol-and-detached--5e4f0e87`.
- Client/UI: `die-a86675007a5e-task_592a70dc-a86675007a5e-task_c81d5fcc`, branch `die/remote-normal-cli-client-and-ui-c81d5fcc`.
- Linux SSH fixture: `die-a86675007a5e-task_592a70dc-a86675007a5e-task_1137d756` , branch `die/production-remote-linux-ssh-end-to-end-f-1137d756`.

This is normal CLI conversation work, not audio. One client connects to one already configured Linux SSH account with preinstalled authenticated die. Strict existing known-host verification; no public listener and no automatically accepted host keys. Existing remote normal subagent profile supplies the model; no fallback to the local conversation model and no credential copying. Configured auth is not proof of provider access.

First-slice boundary: user names an existing absolute **remote** repository path. No local repo snapshot transfer, automatic patch return, Mac capability bridge, home/tools/secrets cloning, fleet manager, or environment provisioning. [User repo decisions](user-decisions.md) remain the desired later behavior, not silently reinterpreted as this narrower slice. Explicit per-task model overrides are not part of this slice.

Control is SSH stdio; detached task owners outlive the control connection and client process. Persistent launch intent and same-ID retry must not become a new task after a lost reply. Reconnect is not server restart; identity/epoch mismatch and unverifiable running state remain unknown rather than replaying tool effects.

## Use (both endpoints need this compatible build)

On the Linux account, configure the existing normal profile through die's existing /subagents UI, or the existing `~/.die/subagents.json` format, for example `{"normal":{"model":"provider/model","thinking":"medium"}}`. Authenticate the provider on Linux using the existing die setup. A missing normal model fails explicitly. If normal omits thinking, this slice resolves it to explicit `off` (shown by handshake and passed to the child), not an unstated local/remote-conversation fallback. This feature does not install or upgrade the remote executable.

In a **normal local die conversation**:

1. `/remote connect <existing-ssh-alias> [absolute-remote-die-path]`. The optional path defaults to `die` on the remote SSH command PATH. Provision known_hosts separately using your normal trusted verification process; this command never accepts an unknown key.
2. `/remote launch /absolute/existing/remote/repo Your task prompt`, or ask the normal agent to use its `remote` tool with an explicit remote `repoPath` and prompt. The tool cannot configure hosts.
3. `/remote status` lists cached observations and IDs. `/remote sync <taskId>` catches up pages and state. There is no implicit background polling or progress-stream subscription in this slice.
4. `/remote transcript <taskId> [event-offset]` reads 50 cached events without network/provider contact. Repeat using `nextOffset`; raw conversation/tool text is retained in the local cache. Tool spill artifacts/large files remain separate remote files, not automatically transferred.
5. After an uncertain launch, `/remote retry <same-taskId>` reconciles the saved immutable intent. Do not make a replacement task to recover a lost reply. Identical unknown intent without an ID is refused. Known accepted tasks are not launched again by client retries.

Local state: `~/.die/remote/state.json` (private, atomic events+cursor), with an OS-backed SQLite lock that releases when the client dies. Cache limits refuse further writes rather than silently evicting history. Remote state: `~/.die/remote-owner/`, identity/boot epoch, per-task config/intent/session/event journal. Remote normal settings affect future acceptances only. Launch acknowledgement is not task completion. Server reboot/identity change is not a client reconnect and must not replay work.

## Verification and run instructions

Build without installing: `bun run prepare:assets`, then `bun scripts/build.ts` (normal full build), or `bun scripts/build.ts --reuse-web` only when staged compatible web assets are available. Here node_modules and prebuilt web assets came from `/home/tnfssc/Code/die`; the normal CLI code was compiled from this worktree. This is not evidence of a clean web rebuild.

Run focused checks: `bun test tests/remote-client.test.ts tests/remote-extension.test.ts tests/remote-runtime.test.ts tests/remote-owner.test.ts tests/cli.test.ts`, plus `bun run check`. Run isolated Linux Docker SSH end-to-end: `DIE_REMOTE_E2E=1 bun test tests/remote-e2e.test.ts`. It generates throwaway host/client keys, uses fake-only provider credentials, requires pinned known_hosts, exercises actual normal CLI assembly, and cleans up its container/image/temp files. Temporary build inputs default to project .cache (or TMPDIR) because compiled die may exceed a small tmpfs.

Final Linux fixture passed on compiled normal CLI 0.15.6, SHA256 `1a7927f533e88df0642ba4467660eaa55ee9cc4d1cb673b339e0a53d976d62a2`: 64 durable events, actual normal remote tool and human /remote connect, pinned SSH/unknown-key refusal, client SIGKILL during remote work, model yield while a background job continued, subsequent Linux model turn, new client catchup, real native question detection, and stopped-server paged transcript rendered through normal conversation history (including the actual final assistant message). The fixture imported no experiments. Container/image cleanup was checked. Earlier failures exposed fixture issues and a real nested-task-error decoder bug; a regression now ensures an unknown task's error/questions are cached rather than discarded as a transport error.

`bun run check` passed. The focused/regression set covers 35 tests in eight files: remote client/extension/runtime/owner, compiled CLI, architecture, prompts, system prompt. Source architecture checks confirm no production import from experiments/scripts. Client tests kill a real client process during an ambiguous launch and reopen the same saved ID; other tests cover lost replies, changed owner/boot epoch, intent conflicts, contiguous-page gaps, provider errors/abort, output bounds, and mismatched effective model refusal. This is not a full-repository test run.

Before sending the task prompt, the owner asks the real child RPC session for its effective provider/model/thinking and refuses a mismatch. This prevents CLI fuzzy model resolution from silently substituting a differently priced model. Merely configured credentials are still reported as unknown readiness, not verified provider access. Real Mac, real provider, real server login, WAN and power-loss durability remain unproven. No arbitrary SSH host or user secret was accessed. No push/release/install is authorized.

## Explicit first-slice limits and recovery

- Native questions use the real ledger and are projected with their text/owner/version. An unanswered question is **unknown, not done**, with a clear remote-answering-unavailable error. This slice does not send native answers from the local /remote UI. After the owner has exited, the user can inspect/resume the recorded session directly on Linux with normal die; the remote task is not silently restarted or marked completed by that separate work.
- Remote owners keep the ordinary RPC process alive when native background jobs are still active. Completion requires native `agent_settled` plus paged job inspection and question/pending-message checks, not just a model `agent_end`. Provider error/abort is unknown, not success. RPC shutdown has a bounded kill fallback; a forced or unverifiable exit is unknown.
- Task runtime is capped at one hour. There is not yet a remote cancellation command. A task may have performed external effects even when its outcome is unknown; no automatic replacement run is allowed.
- Journal limits are 32 MiB/task, 512 KiB/RPC row, and 2 MiB/sync page. Client cache limits are 128 MiB and 100 tasks. Limit/corruption/gap errors are explicit, not silent clipping or a complete-transcript claim. Already-synced pages remain readable; artifact files and larger outputs remain on Linux. There is no automatic eviction.
- Local and remote control serialization use OS-released SQLite locks while the durable records remain atomic JSON/JSONL. This closes the killed-client/control-lock trap without unsafe stale-lock deletion. The original prototype-style mkdir control lock is not used.
- No real server details were supplied to this subtask, and no arbitrary SSH host was accessed. Both Linux SSH fixture endpoints used the compiled normal CLI; this is not a real Mac or paid-provider test.

Owner hardening worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_592a70dc-a86675007a5e-task_1774bd36`, branch `die/harden-production-remote-owner-lifecycle-1774bd36`. Worker was stopped after its implemented tests passed but its final response stalled; its changes were preserved as `5db8db3`, reviewed/integrated as `c2bb6b8`, then finished by the integration parent (native checkpoint, OS-released owner lock, real native-question fixture).

## Wisdom

Reused proven ownership, durable cursor, and uncertainty principles without importing experiment code. Values unchanged: existing one-owner, truthful-state, bounded-output and safe-work principles already cover this slice.

## Owner completion/sync serialization (2026-09-27)

Worktree: `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_c15887b3`, branch `die/fix-remote-outcome-race-c15887b3`. Previously sync's control transaction read running, probed the PID, then wrote unknown, while detached owner wrote done outside that transaction. An owner finishing between the read and PID probe could have its durable completion replaced by unknown. Owner running and terminal transitions now use the same OS-released SQLite lock as sync; terminal publication reads the current state inside the transaction and leaves existing terminal records unchanged. The lock covers transitions only, never the long RPC lifetime. Truly dead owners without a durable result still become unknown and are not relaunched.

The owner regression coordinates a real second-process owner at its RPC settlement while sync is inside its PID check; with the original owner.ts it reproducibly returned unknown over the terminal result (baseline exit 1), and with serialization it returns running then done after the lock releases. Existing dead-owner recovery asserts unknown. Verification: owner/runtime tests 2 pass (36 assertions); TypeScript `tsc --noEmit` passed using the existing dependencies/assets; `biome check` on touched TS files reported only pre-existing non-null assertion warnings; compiled CLI Docker/SSH fixture passed (1 E2E, 25.7s) using a copied existing web runtime and temporary build output outside Git. Baseline race regression against original owner.ts failed with unknown in place of running/done, as intended. No client/extension edits, install, push, or production SSH host access. Existing truthful-state/one-owner values still cover this case; no new cross-project value needed.
