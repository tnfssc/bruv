# Package C: injected MCP and child isolation

## Integration API (2026-10-03)

`src/claude-compat/mcp.ts` uses the actual MCP SDK 1.27.1 (added to package.json/bun.lock). It imports no old T3 bridge, TaskManager, job-delivery, wire, frontend or runtime. An instance owns **connections, not task execution**.

Native binding sequence:

1. Capture the caller's injected `{mcpServers: ...}` from native flags into host-only memory. Never log/save argv, headers, descriptors or bearer values in Pi metadata/prompts/artifacts. Do not interpret old T3 environment bridge variables as native config.
2. Call `scrubRootEnvironmentInPlace(process.env)` **after capture, before loading extensions/tools**. This is opt-in at native startup; ordinary CLI root behavior is unchanged.
3. `await InjectedMcpSession.open(config, { cwd, appOwnedServers: ["t3-code"], policy, signal })`. Explicit trusted ownership classification is required (use [] for external servers). Neither server name, annotation, description nor model text grants identity/role authority.
4. Register `session.tools()` under their actual `mcp__SERVER__TOOL` names and JSON input schemas. Optional selectedTools filters discovery independently from allowedTools/permissions. Exact names and MCP server wildcards are supported. Binding translates real MCP content/errors into Pi results; no fake task projection or Bash renaming.
5. `await session.callTool(name, input, {toolUseId: actualPiCallId, signal})` performs one permitted call and returns actual MCP CallToolResult. App IDs remain app IDs. Tools starting bruv_task_ are excluded, never routed to patched native methods.
6. Project `status()` as observed connection state. **Await close()** on EOF/process teardown/config replacement, then open a new manager. Cancellation isolates old results. Session AbortSignal initiates close; binding still awaits it and reports failure.

Required policy supplied by the trusted binding:

- `authorizeServer(name, descriptor, signal)`: endpoint/command admission before any network/spawn. Receives a private clone, not permission to log it. Supplied config is not proof of T3 identity.
- `authorizeTool(request)`: actual tool name, submitted input, Pi tool-use ID, owner, effect and cancellation signal on **every call**. Discovery/selection/readOnlyHint are not approval.
- `beforeAppOwnedCall(request)`: mandatory for app_owned calls; receives final permission-updated input. Check actual active run/provider/session ownership, trusted normal-worker configuration/target and allowed app orchestration actions. Model-authored role is not policy. Check current policy, not only discovery-time policy.
- Binding supplies delegate_task's owner-bound stable clientRequestId only according to the verified upstream replay contract. Lost responses return call-failed with a possibly unknown mutation outcome. Manager never retries, generates a fake receipt or launches a worker clone.

App task_status/task_cancel are explicit upstream tools, never jobs.inspect/stop aliases. MCP close does **not** cancel app tasks. Bruv launches/stops/delivery ACKs remain their actual owner's responsibility. No implicit model continuation, task registry, local/native duplicate launch or delivery ACK is created.

## Permissions

`createPermissionPolicy` in permissions.ts is optional and conservative: disallow wins; preapproval is separate from selection; dontAsk rejects unapproved calls; bypass needs explicit dangerous opt-in. acceptEdits accepts only binding-classified enforced edit tools. Plan accepts only binding-classified enforced read-only tools and rejects arbitrary execute/MCP even with preapproval. MCP readOnlyHint is not authority. Bash/Bash(*) never match execute; callback gets actual code/label/input. Other Claude rule syntax is not implemented here and must not be advertised by the flag binding.

Binding owns native can_use_tool control correlation/cancellation, tool selection, sandbox/worker/depth policy and mode changes. This helper cannot approve a saved human question. Normal CLI does not use it unless explicitly composed.

## Child isolation

Shared factory strips all T3_ (old T3_MCP_* and new T3_ACP_MCP_*), BRUV_T3_, BRUV_ROOT_ and BRUV_REMOTE_ROOT_ controls. Configured provider auth, destination HOME/PATH and explicit T3CODE workspace setup variables stay. Execute keeps BRUV_REMOTE_RUNTIME_STATE for current-owner helpers; local/SSH agent children remove it before the destination owner assigns a child checkpoint.

Existing execute/shell/local-agent sites already use this factory. Added final TaskManager spawn enforcement (even explicit env), SSH bootstrap, destination remoteChildEnvironment and Git snapshot/integration helper enforcement. MCP stdio inherits only its own configured env plus SDK safe OS defaults, not root providers/other servers' credentials. Explicitly configured per-server provider auth is preserved.

This is hygiene, **not an OS sandbox against same-user code reading files**. Scrubbing/annotations cannot make TypeScript read-only.

## Executed proof

Final combined focused run: **86 tests passed, 513 assertions, 11 files**, including package C, affected TaskManager, remote placement/descendant environment, repository, SSH, subagent and existing bridge suites. Real localhost HTTP SDK fixture proves initialize/list/call, two simultaneous auth scopes, selection/permission denial, no patched bridge tools, app guards/actual returned app IDs, explicit app task_status/task_cancel without implicit cancel/ACK, lost committed response without retry, old-call cancellation/replacement and DELETE/connection teardown. Real SDK stdio subprocess proves per-server auth isolation and confirmed PID exit on close.

Actual TypeScript runner, TaskManager subprocess and fake SSH executable exercising the real SSH bootstrap prove root-control absence and configured provider preservation. Fake SSH is not an authenticated remote/provider run. An additional 39 ordinary bridge/subagent/SSH/repository regression tests passed with SHELL=/bin/bash. Fish startup in this worktree emits mise-untrusted-config diagnostics into shell output; two original shell assertions fail on that diagnostic, not credentials. No trust/config change was made.

Prepare assets first (`bun scripts/prepare-assets.ts`), then focused tests. Full TypeScript check passes with generated runtime assets. Parent owns build/notice/release integration.

## Remaining binding gates

No runtime/frontend/wire/root CLI edits. Binding still must do early capture/scrub, real registration/content mapping, permission controls/correlation, active-run/provider/worker policy and awaited shutdown. No genuine T3 browser/backend/model/provider acceptance is claimed.

Supported injected transports: HTTP streamable and stdio. SDK in-process, legacy SSE, interactive OAuth setup and arbitrary config fields explicitly reject; dynamic tool-list-changed refresh is not advertised (replacement closes/rediscovers).

Teardown reports close-failed/teardown-failed honestly: bounded HTTP DELETE (at most five seconds) then SDK close. Protocol-allowed 405 does not prove remote task cancellation. SDK stdio closes/terminates its server process; authorized servers remain responsible for their own descendants. Runtime separately closes its actual Bruv task subtree. No T3 changes, external submissions or releases.

Values unchanged: one-owner, truthful observed-state, safe-data and honest-proof principles already cover this implementation; no new general principle needed.
