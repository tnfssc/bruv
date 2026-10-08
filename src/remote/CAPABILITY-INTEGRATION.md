# Durable remote capabilities — ownership and integration

Capabilities are wired into the normal remote task path. This guide follows request/reply ownership and the underlying module interfaces; see [README.md](README.md) for human commands and [integrated normal-session evidence](../../wisdom/remote-workspaces/integrated-normal-session.md) for whole-path evidence and limits.

## Authority and storage boundaries

- The human explicitly grants named read-only capabilities in the local repository. The client owns a private (0700) grant store containing the local root; only metadata `{id, taskId, kinds}` crosses transport. Neither an agent request nor transport replay can invent a grant.
- The transport must authenticate/pin `ownerId + epoch + taskId` before invoking owner hooks. The owner derives `join(root, "tasks", taskId)` from trusted state, never a task directory or local root supplied in a remote payload.
- The owner supplies `BRUV_REMOTE_RUNTIME_STATE` (the task’s `runtime.json` path) privately to its child. This is how the child locates the mailbox, not authority to access the client’s repository. Do not trust an environment string supplied by a remote requester.
- Keep the owner task directory private (0700). Mailbox grant/request/reply records are immutable, fsynced and atomically linked. Owner reply, revoke and terminal operations are serialized in the owning process; do not run independent owner writers for the same task directory.

There are no arbitrary `tool:...` names, shell, machine-wide or credential grants. These capabilities perform read-only operations; do not blindly replay uncertain **mutation** intents.

## Integrated request journey

1. **Client accepts the human grant.** `grantCapabilities` in [services.ts](services.ts) creates the local `ClientCapabilityStore` record, then sends only grant metadata through authenticated `client.control`. [owner.ts](owner.ts) checks the task is live and calls `OwnerCapabilityMailbox.acceptGrant`.
2. **Owned child requests and waits.** The typed `remote.requestCapability({ kind, input, requestId? })` bridge dispatches through [operations.ts](operations.ts) to `requestLocalCapability` in services.ts. It records a missing-grant need and waits for a matching grant. Once granted, it calls mailbox `execute` with the same request ID. The real waiting Promise runs in the child; it is not a model completion or a grant from the agent.
3. **Owner exposes pending work.** Authenticated sync returns mailbox `pending()` requests and missing-grant needs for live tasks. The owner does not read the local repository. Missing grants or an offline client genuinely leave the child waiting, subject to cancellation and deadlines.
4. **Client freezes and delivers the read result.** After sync, [client.ts](client.ts) calls `serviceRemoteTask`. Its capability service calls local `serve` and persists `{request, reply}` in client-owned `capability-replies/<taskId>/<requestId>.json` **before** sending the reply intent. A retry verifies the saved request and resends the exact saved reply, rather than rereading changed local files.
5. **Owner persists; child observes.** The authenticated owner checks the reply’s task fence and calls `box.reply`. Its result is returned only after the durable mailbox operation. The child’s mailbox wait then resolves the value or rejects the reported error. Stale, cancelled, terminal or revoked requests cannot receive a new accepted reply; conflicting reply bytes throw.

## Replay, revocation and task end

Preserve `requestId` across retries/restarts. Reusing an ID with a changed payload is rejected; a new ID is a new request. Durable mailbox state survives an owner restart, but not the in-flight JavaScript Promise: re-establish the wait with `execute` and the original pinned ID. This storage property does not authorize bypassing the transport’s owner/epoch fence or automatically relaunching a task.

The client revokes its local grant **before** notifying the owner. `revokeCapability` reports whether that notification reached the owner; a failed notification is not proof of owner revocation. Local servicing skips revoked grants. Owner revocation rejects the mailbox wait and prevents late replies.

Cancellation and terminal publication in owner.ts mark the mailbox terminal. The child wait rejects on cancellation, deadline, revocation or terminal state; the owner rejects late replies after task end. Retention/GC should occur only after terminal state **and confirmed task retirement**, not merely after a reply.

## Module interfaces

These low-level calls illustrate the boundaries above; they do not replace the human grant or authenticated transport checks.

### Owner control hooks

`taskDir` is the trusted owner task directory. Serialize these mutations in the owning process.

```ts
import { OwnerCapabilityMailbox } from "./capability-runtime";
const box = new OwnerCapabilityMailbox(taskDir, taskId);
await box.acceptGrant({ id: grantId, taskId, kinds }); // Only after explicit human/client grant acceptance.
const requests = await box.pending(); // Returned by authenticated sync.
const accepted = await box.reply(reply); // Authenticated task/grant/request fence; false if stale, conflict throws.
await box.revoke(grantId); // Authenticated revoke hook.
await box.terminal(); // Cancellation/task end hook.
```

### Owned child wait

The integrated helper locates the task mailbox from the owner-pinned runtime path and waits for a grant before this call:

```ts
import { OwnerCapabilityMailbox } from "./capability-runtime";
const box = new OwnerCapabilityMailbox(taskDir, taskId);
const value = await box.execute(grantId, "repo.read", "README.md", {
  requestId,
  signal,
  deadlineMs: 3600_000,
});
```

### Client-local grant and read

Persist the store in a **client-owned** 0700 directory, never the remote task directory. Client grant records are not mirrored into owner storage; only explicit metadata is sent.

```ts
import { ClientCapabilityStore } from "./capability-runtime";
const local = new ClientCapabilityStore(localPrivateDirectory);
const metadata = await local.grant(taskId, absoluteLocalRoot, [
  "repo.read",
  "tool:git-status",
  "tool:git-diff",
  "skill:review",
]);
// Send metadata only after explicit /remote grant. Never send the local root.
const reply = await local.serve(request, abortSignal);
// Persist {request, reply} locally before authenticated, fenced delivery.
// Owner acknowledges after box.reply() completes its durable write.
await local.revoke(metadata.id); // Then notify the authenticated owner to box.revoke(id).
```

## Read scopes and bounds

| Kind | Input and permitted read |
| --- | --- |
| `repo.read` | Relative regular-file path; no symlink or credential path; max 16 KiB, fatal UTF-8 decoding. |
| `tool:git-status` | Empty input; tracked status without untracked enumeration. |
| `tool:git-diff` | Exact safe regular-file relative path; no external diff, textconv or local Git filters. |
| `skill:<name>` | Empty input; reads `.agents/skills/<name>/SKILL.md`, not arbitrary skill execution. |

Other kinds are rejected. Known credential paths, including `.git` and `.env`, are denied for generic reads even when granted; exact sensitive-file overrides are deliberately unsupported. A malicious process replacing repository ancestors concurrently is outside the path-based reader’s confinement guarantee; use a trusted local repository root.

The mailbox bounds each task to 1024 request records and 32 pending requests. Missing-grant needs are also bounded to 32, and owner grant records to 64. Capability output is bounded to 16 KiB. Reaching these bounds does not authorize deleting active task state or widening a grant.
