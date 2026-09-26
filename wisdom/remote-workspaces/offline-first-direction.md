# Offline-first remote agent research

## User goal (2026-09-26)

User has a repo and wants to work on an SSH Linux server, not their MacBook.
The whole agent must keep working when the MacBook loses its network.
They want near-zero setup, including model auth, skills, custom CLIs and CLI secrets.
They asked for web research with tvly before choosing a design. No implementation requested yet.
An optional command route back to the Mac is an idea, not a requirement.

This settles an open question in ssh-research.md: laptop disconnect survival is required.
Local-agent/remote-tools alone does not meet this goal.

## Working direction, not approved design

Remote host owns the agent loop, tools, child jobs, history and pending questions.
Local client attaches through SSH. Losing a client is not a stop request.
Use existing SSH config and host verification. Do not expose a public daemon by default.
Remote auth must work without the laptop. SSH agent forwarding and a laptop model proxy do not meet that need.
Offer remote login or scoped remote credentials. A hosted credential broker is another choice, not needed for a first version.
Do not copy all local auth files or a whole home directory. OAuth refresh, keychains, subscriptions and expiry need provider-specific checks.
Sync selected skills and plain config. Install Linux builds of tools; do not copy Mac binaries.
Let an agent diagnose setup gaps, but do not let it quietly grant itself more access.
Optional Mac tools must be marked online-only. Show blocked work when the Mac goes away.

## Research in flight

- task_563c7d59: Cursor, Claude, possible OpenClaw identity and product evidence. Shared research only. Output: product-research-2026-09-26.md.
- task_7344a0a8: Codex source/docs and current die runtime gaps. Shared research only. Output: runtime-research-2026-09-26.md.
- Parent: Coder, VS Code, secret stores and setup UX. tvly search works here. Temporary raw results in /tmp/die-remote-{coder,vscode,secrets}.json; useful sources must be saved in final notes.
- No code changed. No SSH host configured or contacted. No credentials read or copied.

## Next

Read both research reports and check their evidence. Compare product patterns.
Write a concrete first-run/reconnect UX and credential options for discussion.
Separate laptop link loss from server restart recovery. Test both before claiming both.
Use an actual cross-machine test in implementation, including remote provider auth and child agents.

Values unchanged. Existing ownership, recovery, truthful proof and user safety values cover this direction.

## User refinement: offline reading and on-demand Mac access

User added two requirements after the initial research summary:

- MacBook must let them read transcript and already-synced progress even when the Linux server is offline. Full project file access is not required. Keep a durable local transcript replica, not just a live server view. Be honest about the last synced event; work produced while both sides cannot communicate cannot appear locally yet.
- Do not assume eager repo, skill or CLI copying. User prefers the remote agent to request needed capabilities from the Mac on demand. The earlier bulk provisioning/sync sketch is not an agreed design.

Proposed interpretation for discussion: remote agent still owns execution; Mac provides optional, explicit on-demand tools/content plus a read-only local transcript replica. Use stable event IDs and reconnect catch-up rather than a second competing session owner. Persist enough tool output, results and pending questions to make the cached transcript useful. Large artifacts can have separate availability state.

The offline tradeoff must stay visible: remote work can continue while Mac is offline only with capabilities already available remotely. A needed Mac-only tool/file/skill then blocks that step. Agent can do independent work and save a request; it cannot fetch from a disconnected Mac. On-demand access may mean invoking a CLI on the Mac, reading skill text from it, or fetching selected content; do not silently reinterpret it as installing everything on Linux. Repo location and any task-specific checkout can be decided when needed, not an upfront whole-repo copy requirement.

Next design should show both cases: server offline -> cached transcript on Mac; Mac offline -> remote work continues where possible, Mac-dependent steps visibly wait. No implementation yet. Values unchanged; one owner with read replicas and truthful stale/offline state fit existing values.

## Research handoff status

Runtime review completed in runtime-research-2026-09-26.md. Parent saved environment and primary product cross-checks in environment-research-2026-09-26.md and discussed them with user.
Product worker task_563c7d59 produced no further tool output after a shell syntax failure at 16:52 despite ongoing model events. Parent requested cancellation at 17:10; initial stop result was still running (not proof of exit). No final product report was delivered. Do not wait for that report to proceed; useful product claims were independently checked by parent. Research is enough for design discussion, not a full competitive audit.
Latest user refinement above supersedes the earlier eager provisioning proposal. Next work is design discussion, not authorized implementation.

Product worker cancellation confirmed: killed, exit 143. No research jobs remain running.

## Narrowed target: MacBook plus one Linux server

User first described one conversation launching tasks on A/B/C/local against the current repo. They then narrowed the design target to their usual MacBook plus one Linux server. Multiple servers may not reach each other; do not build a mesh coordinator for that edge case now.

User is weighing coordinator and Live placement, not prescribing local model execution. They explicitly considered forwarding microphone/speaker audio to remote model calls. Do not equate local audio hardware with mandatory local agent ownership.

Recommendation for discussion: Mac owns the interactive conversation/Live UI and transcript replica; Linux owns independent delegated task agents, their model calls, jobs, saved outcomes and questions. Local coordinator can disappear without killing already accepted remote tasks. Tasks needing further parent decisions wait durably; no claim that laptop-owned cross-task orchestration continues offline. A multi-step autonomous assignment can be delegated as one server-owned task. No need for another always-on global coordinator in this first shape.

Keep voice on Mac initially to reuse the current path; remote voice transport is an optional later choice, not required for remote task survival. Server task auth must remain independent of the Mac. Mac-only capabilities are online-only and may block a step when unavailable. No eager environment cloning; prepare required repo state on demand with explicit revision/local-change identity.

Still discussion, no implementation requested. User has not yet approved this recommendation. Existing values cover this narrower owner split; unchanged.

## Remote prerequisite proposal during experiment round

User proposes requiring die CLI to be installed and authenticated on remote machines already. They have not yet decided remote model or setup selection. This is a good way to remove auto-install and credential migration from the first proof-of-concept; do not treat it as approval to change remote machines or move secrets.

Recommendation for discussion: remote host has an explicit task profile/default; local coordinator requests a named profile or an explicit provider/model override. Handshake reports runtime/protocol version, available profiles and provider auth readiness (no secrets). Launch acceptance echoes resolved provider/model, reasoning level and relevant execution setup so there is no silent fallback or hidden local-config inheritance. Unknown/missing/expired auth blocks launch visibly or asks for action; discovery of a credential file is not verified provider access. Start with one remote default profile, not profile synchronization infrastructure. Repo revision/workspace and permission/capability access remain separate from model choice. Accepted task keeps its resolved configuration for its lifetime; a later default change affects new tasks only.

User direction still in discussion. Experiments continue; no production implementation yet.
