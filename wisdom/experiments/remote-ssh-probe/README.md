# Real SSH transport fixture

Run from the repo root:

```sh
bash wisdom/experiments/remote-ssh-probe/run.sh
```

Requires Docker, Bun, ssh, ssh-keygen, Python3, sha256sum and GNU timeout. Tested host: Linux. Override BUN_BIN and DIE_BIN if needed; default die is dist/die. Uses actual packaged die and real SSH, but the model provider is deterministic and fake. No existing remote machine or user's SSH configuration is used.

The runner creates an owner container and an sshd container on one private network namespace. Only the SSH port is published to host loopback. The task owner starts independently of the SSH login. All hello, launch, retry and sync calls go through an SSH local forward. The runner kills that forwarder during real execute, confirms the owner is unreachable through the lost forward, waits four seconds, reconnects and verifies subsequent model/tool turns. It then removes both containers and validates the cached transcript offline.

Keys and known_hosts are generated in a private temporary directory. The client private key stays out of container mounts and build contexts. Only the SSH host private key and authorized client public key enter sshd. It copies those into root-owned tmpfs files so StrictModes stays enabled. Client uses strict pinned host checking, an explicit identity, no SSH agent and no user/global config or key updates. A deliberately wrong host key must fail host-key verification. This root-login fixture is not a hardened remote account design.

Cleanup removes only this run's images, containers, network, volume and temporary keys. Image builds have deadlines; remote task has a watchdog; sockets and polling are bounded. Packages are installed inside disposable Docker, not on the host. Dynamic local port selection retries collisions.

Printed timings separate SSH setup+hello, launch over an already-connected tunnel, and reconnect+catchup with a NEW SSH connection. They include local process startup and readiness polling. No fixed 250ms startup sleep remains. Single-run timings are not statistical network latency or TCP-byte measurements. No Toxiproxy impairment in this fixture yet.

See [measured findings](../../remote-workspaces/ssh-transport-probe.md). Actual Mac sleep/wake, WAN impairment, real provider credentials, provisioning and restart recovery remain separate tests.

The runner also records OpenSSH-reported sent/received counters for each connection. They are not a calibrated packet capture, TCP/IP-header count, or per-task byte total. Missing counters are printed as null, never zero.
