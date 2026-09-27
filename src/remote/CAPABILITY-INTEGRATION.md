Production wiring is now in services.ts, owner.ts, runtime.ts and the typed execute bridge. This file describes module interfaces; see README.md and wisdom/remote-workspaces/integrated-normal-session.md for whole-path evidence and limits.

# Durable remote capabilities — integration hooks

This module is infrastructure, **not wired into transport or the remote child yet**. Do not announce usable capabilities until the parent integrates the protocol and runtime tool. The transport must authenticate/pin ownerId + epoch + taskId before invoking these hooks; never accept a task directory or localRoot from a remote payload. Keep the task directory private (0700); request/grant/reply files are immutable, fsynced and atomically linked. Reply/terminal/revoke operations for a task must be serialized in the owning process. Do not run multiple independent owner writers for the same task directory. No arbitrary tool: names, shell or machine-wide grants.

Owner (task directory is `join(root, "tasks", taskId)`):

```ts
import { OwnerCapabilityMailbox } from "./capability-runtime";
const box = new OwnerCapabilityMailbox(taskDir, taskId);
await box.acceptGrant({ id: grantId, taskId, kinds }); // ONLY after explicit human/client grant acceptance
const value = await box.execute(grantId, "repo.read", "README.md", { requestId, signal, deadlineMs: 3600_000 });
// Real Promise: stays awaiting offline; rejects on cancellation/deadline/revocation/terminal.
// On sync, return await box.pending() to the authenticated client.
// On authenticated reply intent (pinned taskId):
const accepted = await box.reply(reply); // false means stale/terminal/revoked; conflict throws
// On stop/end: await box.terminal(); On revoke: await box.revoke(grantId).
```

Provide the runtime child an authenticated grantId + taskId via private configuration and use DIE_REMOTE_RUNTIME_STATE (runtime.json) to determine the task directory only if the parent created/pinned that path; do not trust an environment string supplied by a remote requester. The owner executes the mailbox Promise; the child needs a typed remote.requestCapability tool bridge to the owner, not a fake model completion. Preserve requestId across retries/restarts; same ID with changed payload is rejected. Sync may repeat requests, and authenticated clients should reply with the same persisted reply intent. Do not blindly replay uncertain **mutation** intents; these grants support only read-only operations.

Client (persist in a local **client-owned** 0700 directory, not the remote task directory):

```ts
import { ClientCapabilityStore } from "./capability-runtime";
const local = new ClientCapabilityStore(localPrivateDirectory);
const metadata = await local.grant(taskId, absoluteLocalRoot, ["repo.read", "tool:git-status", "tool:git-diff", "skill:review"]);
// Send metadata {id, taskId, kinds} only after explicit /remote grant. Never send localRoot.
// Client receives pending requests from authenticated owner sync:
const reply = await local.serve(request, abortSignal);
// Persist this reply as a client intent *before* sending it, so retries resend exactly identical bytes.
// Reply with authenticated, fenced taskId + grantId + requestId; server ACK after box.reply() durable write.
await local.revoke(metadata.id); // plus authenticated owner box.revoke(id)
```

Supported kinds: repo.read (relative, no symlink/credential path; max 16 KiB fatal UTF-8), tool:git-status (empty input; tracked status without untracked enumeration), tool:git-diff (exact safe regular-file relative path; no external diff/textconv/filters), skill:<name> (empty input; reads .agents/skills/<name>/SKILL.md). Other kinds rejected. Known credential paths, including .git/.env, denied for generic reads even when granted; exact sensitive-file overrides are deliberately unsupported. A malicious process replacing repo ancestors concurrently is outside the path-based reader's confinement guarantee; use a trusted local repo root.

Files are bounded to 1024 request records/task and 32 pending; retention/GC should only occur after terminal state and confirmed task retirement. Parent must reject late replies after terminal. The mailbox remains durable after owner restart, but an in-flight JS Promise is re-established by calling execute again with the original pinned requestId; a new ID represents a new request. Client grant records are not mirrored into owner storage (only explicit metadata is). No transport replay can invent a grant.
