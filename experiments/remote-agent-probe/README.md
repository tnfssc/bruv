# Isolated real-agent loop probe

The container runs the **actual packaged die RPC process** and an in-container deterministic OpenAI-compatible fake SSE model. The HTTP controller and RPC stdin stay in the container; short-lived host viewers POST start/detach and later GET the transcript. The model drives two ordinary `execute` tool calls, including Bun.file, fs.stat, shell and a second model turn after viewer exit. No provider calls or credentials. This is not a shipped transport.

Run from repository root (Linux Docker, Bun >=1.4.1):

```sh
# First build dist/die from this revision: bun run build
bash experiments/remote-agent-probe/run.sh
# To retain the retrieved client transcript (JSON):
PROBE_TRANSCRIPT=/tmp/remote-agent-probe-transcript.json bash experiments/remote-agent-probe/run.sh
```

For an already compiled binary from the *same revision*, set `DIE_BIN=/absolute/path/to/die`; set `BUN_BIN=/absolute/path/to/bun` if Bun isn't on PATH. The runner stages only those binaries and this experiment's server into a temporary Docker build context. Docker pulls `debian:bookworm-slim` if needed. Image and uniquely named container are removed on exit, including failure. Build/pull may take longer than the ~4-second agent loop. CPU 2, RAM 768 MiB, PID 128, read-only container root, 64 MiB tmpfs /work, non-root UID, 55-second server watchdog, loopback-only random published port. No home or Docker socket mounts. The fake model HTTP route itself is not authenticated: this experiment must remain on loopback; do not expose it to a network.

`verify.ts` asserts detachment precedes the first tool result and second model turn, two successful real execute results, Linux marker/cwd, one agent end, and final assistant text in retrieved transcript. Output times are elapsed milliseconds since container server startup (not network benchmarks). Viewer snapshots are different host processes; the reconnect JSON can be copied to `PROBE_TRANSCRIPT`. It is a bounded ephemeral in-memory server transcript, **not durable** across container death, and doesn't establish remote Mac tools, actual macOS client, SSH, multi-agent scale, or real-provider access.
