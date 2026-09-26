# Isolated SSH + native questions fixture

Linux/Docker localhost only. Reuses the native question fake-provider RPC server and policy, and the disposable SSH transport server; no production transport changes. Owner runs independently in a read-only container with private /work tmpfs. Only SSH is published on host loopback. Client HTTP uses a pinned-key SSH local forward. No real provider keys or existing SSH host.

Build a CLI **from this worktree** (0.15.4 source with question ownership fix), named dist/die-ssh-native-question. With Bun 1.4.2 and repository dependencies installed, stage compatible web assets and run:

    bun scripts/build.ts --reuse-web --outfile=dist/die-ssh-native-question

One command runs policy tests and the whole experiment:

    BUN_BIN=/path/to/bun DIE_BIN=dist/die-ssh-native-question bash experiments/remote-ssh-native-question/run.sh

Omit BUN_BIN when Bun is on PATH. Runner prints binary version and SHA256. It checks wrong pinned key rejection; pending question and owner on disk before disconnect; kills only client SSH; confirms no HTTP without tunnel; reconnects and checks unchanged pending question/owner/turns; rejects wrong bearer, ID and choice; sends exact targeted RPC answer; checks saved reply ID/version/delivery, complete follow-up and no extra turn on duplicate. It caches question, journal and RPC events locally, stops both containers, then reads final assistant text and tool results offline. Scoped images/network/containers/keys/cache are removed on success or failure.

Limits: client disconnect is not server death or WAN loss. Offline transcript is client-side status/RPC-event cache, not a full copy of the owner's session file; it contains readable tool results and final assistant text. Owner's /work tmpfs is destroyed: no owner restart or crash durability proof. Controller bearer is not a same-UID sandbox. Fake provider on Linux Docker only, not production provisioning, Mac, real credentials, power-loss atomicity or user interaction. Duplicate is accepted idempotently by controller and native command, but must add no model turn. No user's ~/.ssh is read or modified.
