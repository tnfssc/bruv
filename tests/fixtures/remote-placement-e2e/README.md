# Normal SSH placement acceptance fixture

This is a **new, independent** fixture. It does not alter production or any existing remote runner. Scripted inference chooses tool calls; every job, question, repository transfer, SSH owner and terminal interaction is production code when acceptance runs.

## Run after the combined source is compiled

Linux, Docker, ssh/ssh-keygen, git, tmux and Bun 1.4.2 are required. Supply an already cached local OS/SSH fixture image containing /usr/sbin/sshd and git. The old remote-e2e fixture image is suitable as an OS base; its configuration/repository is removed and its CLI is replaced. No image pulls or apt installation occur. Missing base/binary fails, not skips.


Example (replace the base tag and final binary with your own frozen artifacts):

```sh
export TMPDIR=/home/tnfssc/.die/tmp-pi-removal
export BUN_BIN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
export REMOTE_PLACEMENT_BASE_IMAGE='cached-local-SSH-fixture-image'
export DIE_BIN="$PWD/dist/die"
export REMOTE_PLACEMENT_ARTIFACTS="$TMPDIR/placement-final-proof"
"$BUN_BIN" test tests/remote-placement-e2e-fixture.test.ts
"$BUN_BIN" scripts/remote-placement-e2e.ts --probe # Infrastructure only, no CLI proof
"$BUN_BIN" scripts/remote-placement-e2e.ts         # Real acceptance; fails on unsupported placement
```

Do not substitute a placeholder packaged-web archive to obtain a binary. Build the parent's actual combined source using its validated local assets. The runner does not build or make packaged-web claims.

## Isolation and evidence

The runner creates a temporary HOME, XDG/config/cache/state, agent directory, Git fixture, tmux socket, SSH config and ed25519 host/client keys. It drops inherited DIE_* role/runtime values, credentials and SSH agents. Only Docker's endpoint is resolved before isolating HOME; no real Die/provider/SSH configuration is read or mounted. The container receives only fresh public authorization/host keys (read-only), fixture files and the supplied binaries. Build and runtime use network:none; no WAN connection or paid inference is possible from the server. Parent inference listens only on 127.0.0.1 and accepts the parent fixture model only. It is intentionally separate from server inference to detect descendants accidentally running on the parent.

SSH uses the real OpenSSH client and daemon with strict known-host checking. A ProxyCommand runs docker exec into the otherwise networkless container, where ssh-proxy.ts relays bytes to the daemon's loopback socket. This is not an SSH/protocol mock. Rootless Docker here suppresses published ports on internal networks; the byte relay avoids loosening isolation or relying on host networking. No Docker socket is mounted inside the fixture.

Artifacts are text/JSON only: source commit/dirty status, actual binary and Bun SHA256 (acceptance only), Docker base ID and network mode, PTY captures, parent/owner inference requests, durable client/session/question/snapshot metadata, paginated jobs results and return patches. Probe receipts explicitly have no CLI SHA or placement claims. Ephemeral keys/config/binaries/repositories and named container/image are removed on normal success/failure. Artifacts remain at the printed path. No video.

## Acceptance sequence

1. The real terminal types one human /remote connect. Inference reads connection.host and invokes ordinary subagent({type:"orchestrator",target:connection.host,prompt,workspace:{kind:"worktree"}}), with no model override or remote.launch shortcut.
2. Two local commits plus tracked dirty input become a single orphan server snapshot. An unapproved untracked marker remains absent. Durable source head/snapshot/omitted-untracked provenance is asserted; destination does not advertise local history.
3. Destination-installed orchestrator profile and role/depth are checked by real remote shell tools. The orchestrator launches a normal child with target omitted, in a separate server worktree. That child's real shell and refusal to delegate prove both placement and policy.
4. The orchestrator awaits ordinary child completion, inspects paginated jobs output, and asks/blocks on a real human question. Parent execute queries ordinary questions.list for the public question projection (no assumption that bridged rows live in a local questions file). Remote question identity/owner provenance is checked.
5. The terminal client is killed and resumed with the same explicit session file. The same task/question/owner/version remain. The real /questions menu is opened, escaped without answering, then the approval choice is selected explicitly. No agent answers; no /remote answer is used.
6. The remote agent reads the saved answer and resolves it before editing tracked input. Ordinary parent jobs inspection and safe return are asserted without rewriting local commit history.
7. A second task is answered via terminal /questions answer while the parent tracked state has drifted. The parent edit survives and the conflicting remote patch is retained for review, not silently applied.
8. Repeat synchronization and another fresh client cannot redeliver consumed normal completions or create duplicate SSH tasks. Server descendants must not become additional SSH-owner placements.

## Integration assumptions (fail strictly if not met)

- Public execute APIs: subagent accepts target and waitSeconds:0; remote.status returns connection.host; ordinary jobs.list/inspect accepts the returned job ID. Inspect has the established status, output, hasMore and nextOffset fields.
- Destination-installed profiles use ~/.die/subagents.json; effective orchestrator is depth 1 and its normal child is depth 2. Shell launch returns exitCode for completed jobs.
- Native owner and repository backend retain ~/.die/remote-client.json, tasks/<taskId>/session.jsonl.questions.json and descriptor.json snapshot/outcome receipts. Public question projection retains the remote task ID, question ID and source owner session/branch provenance somewhere in its serialized record. Adjust receipt-path readers only if integration changes those paths; do not weaken the semantic assertions.
- Parent explicit --session resumes the same CLI session. Normal asynchronous delivery uses the existing task-complete journal message and includes the final result marker as a user-visible completion/context event.
- Snapshot descriptor still records source head, distinct snapshot, selected/omitted untracked, and applied/review outcome plus patch artifact. Server snapshot checkout is beneath /root, without source Git history.

Not covered by this runner: approved untracked transfer, explicit source base selection, transport response-loss retry, cancellation, real hosts/credentials, WAN inference, web packaging, or future main-agent remote attach. Focused production tests and the existing recovery runner should cover the first four. The human bridge's own tests must assert remote version/epoch routing and prohibit forged tool answers; this fixture additionally validates public identity through actual terminal use.
