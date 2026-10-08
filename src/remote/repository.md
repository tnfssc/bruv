# Repository handoff integration

## Authority and entry points

[repository.ts](repository.ts) captures snapshots, exports patches and decides whether a result can be applied. It never contacts a host or asks the user a question.

The remote owner/client/operations layer owns task IDs, SSH transfer, authentication, final task state, serialization and artifact retention. The production callers are [repository-wire.ts](repository-wire.ts) and [root-client.ts](root-client.ts); [repository-download.ts](repository-download.ts) only downloads and verifies result bytes, not completion or permission to apply.

Keep capture and integration serialized per repository. Keep the repository quiescent during application: this module does not provide atomicity against external writers or crashes between files.

## 1. Client: capture the launch input

Call `captureRepository(localRoot, newPrivateArtifactDir, approvedUntrackedPaths, options)` before launch. The artifact directory must be new, private, durable and outside the repository; keep the manifest and bundle under the task ID. Capture does not mutate the local index or worktree.

Choose the input before transferring it:

- By default, capture the current tracked state, including local tracked changes. The bundle contains an orphan snapshot, not local commit history.
- With `options.baseRef`, capture that source commit instead of current tracked changes. Explicit source commits cannot be combined with current untracked files. The manifest records source provenance; the transported baseline still has no history.
- Untracked files default to none; ignored files remain excluded. Show the user exact paths and get explicit approval **before** passing them as `approvedUntrackedPaths`. Known credential/config paths are rejected; this is not content secret scanning.
- Show `omittedUntracked` so excluded input is visible.

**Capture failure stops launch.** A repository change during capture throws: discard the artifact, do not launch from it.

## 2. Owner: verify the checkout before launch

Transport `bundle` to the pinned owner over the existing authenticated SSH path. Clone it in a task-owned checkout and verify that `git rev-parse HEAD` equals `snapshot` before starting the task with that checkout as cwd.

**Launch only after successful verification.** Use argument arrays and task-bound paths, not shell interpolation. The caller owns cleanup when launch fails.

## 3. Owner → client: preserve the completed result

Only after confirmed task completion, call `collectRepositoryResult(remoteCheckout, snapshot, newRemotePatchPath)` on the owner. Patch generation is not evidence of task completion; the owner/client must establish that separately.

Fetch patch bytes and JSON result together, verify the digest on receipt, and persist both under the same task ID before integration. Use the local patch path in the result passed to integration, not the remote path.

Export and apply have different permissions:

- Ordinary regular remote untracked files are included in the review patch, **never automatically applied**.
- Sensitive or unsupported paths and oversized outputs stop export with an explicit error. The remote checkout remains available.

## 4. Client: decide whether to apply the preserved artifact

Call `integrateRepositoryResult(localRoot, manifest, resultWithLocalPatchPath, durableReceiptDir)` only after preserving the artifact. Integration returns a repository outcome, not a task-completion signal:

| Outcome | Caller action and repository effect |
| --- | --- |
| `no_changes` | No patch to apply; retain the artifact. |
| `review` | Present the reason and artifact location, not success. Inspect manually; do not automatically retry an attempted or uncertain apply. |
| `applied` | Changes are in the worktree only. The existing staged index stays staged; retain the artifact and receipt. |

Automatic application requires matching snapshot/digest, unchanged local HEAD/index/tracked work, and a valid conflict-free patch to existing regular tracked files. New files, deletions, mode changes, local drift, remote untracked files, invalid/complex patches and duplicate attempts remain **review**, not automatic apply. A nonempty patch from an explicit source commit that differs from the captured local tracked state also requires manual integration.

### Receipts survive reconnects

Integration writes an `attempting` receipt before applying. If apply throws, the outcome is `review` with an uncertain-apply reason and receipt location; inspect the worktree before deciding what happened. A completed apply records `applied` in the receipt.

Receipts prevent automatic retry after ambiguous interruption. **Do not delete them on reconnect.** Caller serialization and a quiescent repository are still required; receipts do not make multi-file application atomic.

## Security and verification boundary

- Clean/smudge-filter repositories and oversized snapshots are rejected.
- Git runs without global/system configuration; diff disables external diff/textconv.
- Snapshots, checkouts and transfer artifacts have explicit size/time bounds.
- The remote SSH user remains trusted. Path-based operations are not a hostile concurrent filesystem sandbox.
- Verification is disposable Linux Git/Docker fake-provider fixtures, not Mac, real provider or arbitrary user repositories.
