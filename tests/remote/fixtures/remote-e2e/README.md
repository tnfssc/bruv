# Normal CLI SSH end-to-end fixture (Linux)

Build the integrated production CLI first, then run:

$ BUN_BIN=/path/to/bun BRUV_BIN=/absolute/path/to/dist/bruv BRUV_REMOTE_E2E=1 bun test tests/remote/remote-e2e.test.ts

Or $ BUN_BIN=/path/to/bun BRUV_BIN=/absolute/path/to/dist/bruv bash scripts/remote/remote-e2e.sh.

Requires Linux, Docker daemon, SSH client/keygen, Python, and Bun. The fixture builds a Debian owner with that exact prebuilt $BRUV_BIN (printed version and SHA256), a generated Git repo, isolated fake OpenAI-compatible model and normal profile. No experimental code, real keys, provider credentials or repository secrets enter the container. An ephemeral client key and pinned SSH host key live in a mode-0700 temp directory. The SSH port binds only host loopback; teardown removes container, image, keys and state. The local client runs normal $BRUV_BIN --mode rpc, connects with human /remote, then its fake model calls the **real registered remote tool** to launch work in the already-existing owner Git repo. Killing that RPC client does not kill the owner. A fresh normal RPC client syncs saved owner events and verifies remote execute output and final assistant answer.

This does not establish WAN/Mac behavior, full history across owner restart, real provider credentials, repo transfer, or exactly-once side effects. Docker and fake provider are intentional boundaries. Runs only with BRUV_REMOTE_E2E=1 so default unit suites need no Docker.
