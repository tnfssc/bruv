# Durable transcript catchup in integrated CLI experiment (2026-09-27)

Branch: die/durable-transcript-in-integrated-remote--373d107c. Path: experiments/remote-cli-experience plus the experience-mode-only adapter in experiments/remote-native-question-probe/server.ts. The separate-helper delegation requested was unavailable in this normal worker (only orchestrators may delegate); helper and tests were implemented here, not falsely attributed to a worker.

User decision: full conversation/tool text offline; large files separate. Implemented fsynced hash-chained event journal and 16-record, 65,536-byte record paged catchup, with local persisted sequence/hash cursor. Sync requests only missing records; offline reads local journal even after owner stop. Truncated/corrupt/gap/oversized records refuse completeness. Native question owner/version and uncertain launch behavior preserved. The fixture has no large file artifact transport; /work is container tmpfs and no crash task resume exists. Active owner crash means unknown, no replay.

Evidence (Bun 1.4.2; staged real die 0.15.4 sha256 6a4b0a5775dc244320f1580dc5bc889fe7b4be460d378893c6f145286bddde94; fake loopback model, no credentials):
- bun test experiments/remote-cli-experience/*.test.ts experiments/remote-native-question-probe/*.test.ts experiments/remote-task-poc/*.test.ts: 12 pass, 0 fail; includes paged incremental request offsets 0,16,32 then 33, offline tool text, corruption/gap, owner change and uncertain launch/answer.
- bash experiments/remote-cli-experience/run.sh with BUN_BIN and DIE_BIN: PASS pinned SSH, offline durable paged RPC events, exact native question, follow-up; 75 events. CLI output asserted offline tool and final assistant text after tunnel loss and after owner stop; duplicate launch ID and exact question owner/version observed.
- bash experiments/remote-native-question-probe/run.sh with same binaries: PASS actual native question, reply delivery, four model turns, 79 RPC events.

Not verified: Mac, real provider, large file transfer, disk-persistent server restart, automatic repository return. No user pending questions modified. The original bounded-prefix state cannot be silently upgraded; start with a new local state path.

Parent integrated as 8f5a6c3. Read-only review task_7dfc2007 and parent Docker/native reruns task_fc8629c6 pending. Logs /tmp/die-durable-cli-parent.log and /tmp/die-durable-native-parent.log. Do not push until reviewed. Repo helper integrated separately, still needs same-path wiring.
