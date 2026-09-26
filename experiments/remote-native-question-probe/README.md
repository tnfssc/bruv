# Native question RPC probe

Run `./experiments/remote-native-question-probe/run.sh` from the repository (or set `BUN_BIN` and `DIE_BIN` for alternate staged executables). Requires Docker; stages only the fake fixture server, Bun and packaged die. Fresh token, random Docker names/host loopback port, read-only root, tmpfs /work, no home/socket mounts. Trap removes container, image and staging directory even on failure. Timeout: 55 s internal server, 45 s build, 10 s container start, 50 s verification; bounded 20 s polling phases and 180 RPC events. No real provider or credentials.

A `BLOCKED` report is the observed failing native answer route, **not** a passing remote-native-question claim. Details and minimal proposed fix: [native-question-probe.md](../../wisdom/remote-workspaces/native-question-probe.md).
