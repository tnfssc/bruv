---
name: t3-access
description: How an outside program (the bruv assistant) signs in to T3 Code and what each way in can do, found by trying it against T3 0.1.2-nightly.20261021.3457 on 2026-10-28.
---

# Reaching T3 Code from bruv

T3's server runs on this machine; `~/.t3/userdata/server-runtime.json` gives its origin
(`http://127.0.0.1:3773`). There are two ways in, and the assistant likely needs both.

## 1. MCP at `/mcp` (OAuth)

- Discovery: `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`.
  Scopes `orchestration:read`, `orchestration:operate`. PKCE S256, public client.
- `POST /oauth/mcp/register` (dynamic registration) returns a signed, stateless `client_id`.
- `/oauth/mcp/authorize` redirects to the app's `/connect-agent` consent page. The page calls
  `POST /oauth/mcp/approval` (shows client name) and `POST /oauth/mcp/decision` with
  `{authorization: <authorize params>, decision: {_tag: "pairing-code", access, code}}` (or
  `browser-session` with a CSRF token when a signed-in browser approves). It answers `{redirectTo}`
  holding the code; `POST /oauth/mcp/token` (form body) gives a Bearer token for 30 days, no refresh
  token.
- `access` is the most a thread the agent starts may do: `read-only`, `approval-required`,
  `auto-accept-edits`, `auto`, `full-access`.
- The pairing code comes from `t3 pair --scope … --ttl … --label …` (binary under
  `~/.t3/runtime/versions/<v>/t3`), so sign-in can be done without a browser.
- The MCP session has 83 tools, the same ones T3 gives agents in its threads: `t3_thread_list/read/
  send/launch/wait/interrupt/organize`, queues, attachments upload, projects, schedules, PRs, previews.
  Tools marked "Needs an agent running inside a T3 thread" (`delegate_task`, `create_threads`, worktree
  handoff) don't apply to an outside client.
- No push: capabilities are only `tools` (listChanged), `logging`, `completions`; `GET /mcp` is 405.
  Live state over MCP means polling `t3_thread_list` or blocking in `t3_thread_wait`.
- It cannot approve permission requests: `t3_pending_request_list` leaves them out and
  `t3_pending_request_respond` only answers questions.
- The MCP token works only at `/mcp`; the REST API and websocket reject it.

## 2. The app's own API (pairing token → session)

- `POST /oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
  `subject_token=<pairing token>`,
  `subject_token_type=urn:t3:params:oauth:token-type:environment-bootstrap`,
  `requested_token_type=urn:ietf:params:oauth:token-type:access_token`, optional `client_label`,
  `client_device_type=bot`. Gives a Bearer session for 30 days with the pairing token's scopes.
- REST needs header `x-t3-orchestration-protocol: 2`. `GET /api/orchestration/shell` is the whole
  overview: every project and thread (734 threads, about 1.8 MB) with `snapshotSequence`.
- Live: `POST /api/auth/websocket-ticket`, then `ws://…/ws?wsTicket=…&orchestrationProtocol=2`.
  Effect RPC frames: send `{_tag:"Request", id, tag:"orchestration.subscribeShell", payload:{}, headers:[]}`;
  the server sends `{_tag:"Chunk", requestId, values:[…]}`, first a `snapshot`, then
  `thread.updated` events with the full thread record; answer each Chunk with `{_tag:"Ack", requestId}`.
  Other methods: `subscribeThread`, `dispatchCommand`, `launchThread`, `getTurnDiff`, `searchThreads`.
- The thread record has what an overview needs: `status`, `activityRunStatus`, `pendingRuntimeRequest`
  (approvals), `latestVisibleMessage`, `lastVisitedAt` (unread), `pendingBackgroundTasks`,
  `blockedOnThreadWait`, `lastError`, `pinnedAt`, `snoozedUntil`, `settledAt`, branch and worktree.
- Approvals go through `dispatchCommand` with a `runtime-request.respond` command (seen in the
  client bundle, not tried).

This API is T3's private protocol (versioned, `orchestration_protocol_incompatible` on mismatch), so
it can change with any T3 update; MCP is the stable surface.

## Found while building `src/web/t3/` (same T3 build, 2026-10-28)

- The MCP `pairing-code` decision with `access: "full-access"` needs a code minted with T3's standard
  scope set (`t3 pair` with no `--scope`); a code limited to `orchestration:*` is refused and used up.
- `GET /mcp` answers 405 to a good key and 401 to a bad one, so it is a cheap key check.
- The websocket upgrade answers 426 `{code: "orchestration_protocol_incompatible",
  orchestrationProtocolVersion}` on a wrong or missing protocol, and 401 to a bad ticket. Tickets
  can be used more than once until they expire.
- Shell stream kinds (from the client schema): `snapshot`, `thread.updated` (`location` `active` or
  `archive`), `thread.removed`, `project.updated`, `project.removed`, `synchronized` (only with
  `requestCompletionMarker`). Events carry `sequence`; skip any at or below the snapshot's
  `snapshotSequence`. Four minutes of live traffic showed only `snapshot` and `thread.updated`.
- Not every `snapshot` is whole: one with `resolvedRepositoryIdentityRoots` has no threads and only
  refreshes projects' git identity. It came twice right after the first snapshot and again later.
- `latestVisibleMessage` (`{id, role, text, updatedAt}`) was null on all 741 shell records, running
  ones too; the overview has no last message in practice.
- `pendingRuntimeRequest` is `{id, kind, createdAt, blocking?}`; kind is `command`, `file-read`,
  `file-change`, `mcp-elicitation`, `permission`, `dynamic_tool_call`, `user_input` or `auth_refresh`.
- About two thirds of threads are provider-native subagents (`thread:provider:…` ids,
  `creationSource: "provider"`, `lineage.relationshipToParent: "subagent"`). Their `status` stays
  `idle` even while they work.
- Resume works: `subscribeShell` with `{afterSequence, requestCompletionMarker: true}` (what T3's web
  app sends when it has a cached shell) replays only later events, about 5 KB, then `synchronized`. A
  position too old or in the future gets a whole snapshot (about 1.8 MB) instead, then `synchronized`.
  `src/web/t3/` resumes from the last applied sequence and resets it when T3's origin changes.
- T3's websocket accepts `permessage-deflate`, and `ws` under Node asks for it, so snapshots go
  compressed over the wire. `GET /api/orchestration/shell` gzips 1.8 MB to about 120 KB.
