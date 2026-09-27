# Remote UX experiment round

## Scope

User approved discovery and proof-of-concept code on 2026-09-26. First target is MacBook interactive coordinator plus one Linux server running independent tasks. Dream is many agents on many hosts; test protocol overhead at scale without claiming simulated agents prove real fleet capacity.

Keep production untouched in this round. No real provider credentials or paid calls. Docker daemon 29.6.2 and Docker Compose v5.0.1 are available here. Host is Linux, not a Mac. Toxiproxy CLI not found locally; network worker will use its container. Prior research remains in this directory, including latest user corrections in offline-first-direction.md.

## Work owners

Base commit: a173cd28b80d2ea328d7abc03b5587b86d471e61. Independent durable worktrees:

- task_86a7ae68: end-to-end Docker + Toxiproxy disconnect/catchup UX lab. Path /home/tnfssc/.die/worktrees/die-a86675007a5e-task_86a7ae68, branch die/remote-disconnect-ux-lab-86a7ae68. Owns experiments/remote-network-lab and network-lab.md.
- task_da069f45: standalone compact event/batching/compression and 1/100/1000 simulated agent benchmark. Path /home/tnfssc/.die/worktrees/die-a86675007a5e-task_da069f45, branch die/compact-agent-wire-experiments-da069f45. Owns experiments/remote-wire-bench and wire-bench.md.
- task_3f1110f2: real die RPC loop with fake deterministic provider in Docker. Path /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3f1110f2, branch die/real-agent-loop-remote-placement-probe-3f1110f2. Owns experiments/remote-agent-probe and remote-agent-probe.md.

Parent reviews results, runs integrated commands, and joins measured findings. Workers must commit and record limits. No overlapping code files. Current research notes are uncommitted parent files; worker prompts carry latest decisions because fresh worktrees do not contain them.

## UX checks

- Launch accepted versus locally pending is visible. Lost reply must not duplicate a task.
- Client detach does not stop accepted independent work. Mac-only needs block only dependent work.
- Questions and outcomes survive presentation disconnect. Reply retry reconciles by identity.
- Reconnect asks for missing events, not whole history or rerun prompt.
- Server offline still leaves a readable local transcript with last synced position. Large missing artifacts say unavailable, not empty.
- Slow consumers do not create unbounded in-memory queues. Backpressure must not silently lose canonical history.
- Server restart is separate from client disconnect; unknown work must be labeled unknown.

## Measurements

Record observed launch acknowledgment, first visible progress, completion visibility and reconnect catchup. Separate task runtime from network/display delay. Include sample counts, payload sizes, p50/p95 only where sample count supports interpretation. Start baseline, injected latency and bandwidth cap, outage/lost-reply. Count serialized application bytes separately from actual TCP/SSH overhead. Test batch latency versus size, output growth, metadata fanout and subscription scope.

No universal latency/scale target chosen yet. Do not optimize a tiny packet at the cost of extra round trips or sluggish first feedback. Prefer fewer unnecessary events/history repeats before inventing binary encoding. Tests with 1000 synthetic agents are protocol load only, not proof of 1000 LLM processes or computers.

## Next handoff

Wait for workers; inspect their commits and run probes. Integrate only experiments and their wisdom. Record measured findings and next missing acceptance test. Real Mac/Linux SSH, provider auth refresh, secure bootstrap and local capability permissions still need later proof.

Values checked; unchanged. Existing end-to-end proof, one owner, bounded queues and safe recovery values apply. New measurements belong with experiments until a repeated broader lesson emerges.

## First wire review

Original wire worker committed a02f3e7. Not integrated yet: readable formatting and fair equal-content comparisons needed. Its 1000-agent case streams only 10 active transcripts, and compact mode omits retained tool blobs. Parent did not accept the 4.12 MB versus 49.3 KB headline as an equal-content offline transcript comparison.
Follow-up task_7bef381e owns review fixes at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7bef381e, branch die/wire-benchmark-review-fixes-7bef381e, base a02f3e7. Add full transcript delta comparison, preserve all-task status coverage separately, include 1000 active transcripts, format code and strengthen tests. Await commit then integrate both wire commits if checks pass.

## Integration and review status

Integrated agent probe f0301fd -> 2b9be31; network lab 1dfb5e1 -> d6c87e9; wire original a02f3e7 -> 4ad759b and fair-comparison review ea0c345 -> 53fee7e. Parent formatted, fixed and reran labs. Read-only reviewer task_709117b3 caught misleading discarded-response label and stale units; parent renamed result and replaced old measurements. No true dropped acceptance reply or memory-bound proof claimed.

Network lab parent run passed all invariants, server-down transcript read, 8 joined unit tests and strict standalone TS. Its runner owns cleanup. Real-agent probe passed using prebuilt die; artifact version inspection then showed 0.15.1 while repository package is 0.15.3. Do NOT call that artifact a verified same-source-revision build. Parent launched bun run build (task_84f5a0d4) to rerun against current source; log /tmp/die-remote-experiment-build.log. Until that result arrives, provenance remains an explicit limitation.

Newest user proposal: require die preinstalled/authenticated remotely; choose remote model/setup next. Saved in offline-first-direction.md. No installation or credential migration implementation needed for initial remote proof.

## Round complete

Full build hit missing pnpm. Existing --reuse-web build path rebuilt current CLI successfully (0.15.3); web archive reused, not validated. Current-source actual-agent probe passed: detach 315ms, second model turn 3486ms, completion observed 4323ms during/rejoining a four-second no-client-request window. See agent notes for artifact hash. Network runner and wire benchmark reran; eight unit tests, strict standalone TS, shell syntax and diff checks passed. No production code edited, no full production suite run. Read experiment-findings.md for synthesis and next thin vertical slice. Experiment resources cleaned up; durable worktrees kept for handoff. Values unchanged for reasons in findings.

## Round two started after user said continue

Base bb3e12ba695de5d789f3e18b091cb3d24d875472. Production still untouched. Two independent worktrees:

- task_86d6e797: actual-die durable task vertical proof, remote version/profile handshake, persisted cursor + local transcript, detached progress and explicit lifecycle gaps. Owns experiments/remote-task-poc and task-poc.md. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_86d6e797; branch die/remote-task-vertical-proof-86d6e797.
- task_e7122cd8: polling versus long-poll/stream, byte-capped consumer buffers and gap handling, synthetic 1/100/1000 task network measurements. Owns experiments/remote-stream-probe and stream-probe.md. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e7122cd8; branch die/stream-and-slow-client-network-probe-e7122cd8.

Workers have full current wisdom and may reuse the parent freshly built die 0.15.3 binary with recorded hash. Loopback-only Docker, no real credentials or paid models. Parent will review integration, rerun results and keep claims narrow. First priority is connected actual-agent + durable offline transcript experience, not thousands-machine deployment.

## Round two stream review

Stream worker returned c63d2f5. Parent has not integrated it yet. It used application-delay HTTP loopback (not Docker/Toxiproxy), and carefully disclaimed socket-memory bounds. Review found Log.add advanced cursor before oversize rejection, and client read server log.cursor directly for catchup. Notification also carried full events that client discarded before fetching them again. Negative extra-RTT observation is useful, but needs fairer candidate.
Follow-up task started from c63d2f5 to remove shared-memory oracle, add direct data-bearing long-poll alongside polling and compact hints, test byte-capped pages, fix oversize cursor and format code. Worktree/job identity is recorded below once launch returns.

Stream follow-up task_a4f7eaf8: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_a4f7eaf8, branch die/review-direct-event-delivery-experiment-a4f7eaf8. Base c63d2f5. Actual-die vertical worker task_86d6e797 remains in flight.

## Round two actual-task review

Task worker returned 2370cea (not integrated yet). Actual RPC + append-log + local replica run passed and completed-owner restart changes epoch. Questions and local capability not implemented; this is an explicit gap, not a failed claim.
Parent review found hardcoded runtime version, offline CLI showing only summary rather than transcript, nonpersisted cap reason, envelope excluded from record-size check, and last-sync bytes labeled as total. Follow-up requested fixes and tests, including bounded requests and metadata reconciliation. Do not interpret pending review as ready production code.

Actual-task follow-up task_39581494: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_39581494, branch die/review-durable-task-proof-39581494, base 2370cea. Parent must integrate original plus follow-up after checking tests and limits.

## Round two complete

Stream commits integrated as a0a8293 and ac76cd6. Actual-task commits integrated as 2f73ce7 and 49de980. Parent fixed the stream final-page boolean size boundary, reran 19 scenarios on Node 24.21.0, and reran actual die Docker path twice. Offline reader now accepts offline FILE, prints cached transcript and can retain it with LAB_TRANSCRIPT. Final proof preserved /tmp/die-poc-offline-transcript.jsonl plus meta; reading after container removal showed both real tool results and final assistant text (fake provider). Results in each experiment directory; source worktrees remain for history.

Thirteen unit tests pass (nine Bun, four Node), strict TS checks for all five experiments pass, shell syntax/diff checks pass. No production code changed or full production suite run. Docker lab resources cleaned up; no round-two jobs left running. Normal full build remains blocked on missing pnpm, but current CLI 0.15.3 was built with supported --reuse-web earlier; web not validated. See task-poc.md for artifact hash and exact measurements.

Next highest-value work: durable questions/replies and one explicitly allowed Mac fixture-read capability in the actual-agent path. Warm stream delivery versus cold handshake, real mid-flight reply loss and interrupted-running-owner behavior remain unproven. Do not claim thousands real agents or TCP backpressure from synthetic loopback tests. Values checked again and unchanged; current proof/ownership/bounds rules already cover lessons.

## User authorized ongoing discovery and develop pushes

On 2026-09-26 user asked to do all needed investigation/experiments and keep pushing develop. Parent fetched origin, merged two newer release commits (80872d7, fb4d6fd) without conflicts, reran relevant release and experiment tests (15 Bun + 4 Node), and pushed develop successfully at 6984422. SSH printed an id_rsa libcrypto warning but fetch and push both succeeded; do not report it as an auth blocker. No force push. Package is now0.15.4 from upstream release metadata; the proven staged CLI remains0.15.3 with recorded hash. Do not overwrite artifact while workers stage it.

Round three active from 6984422dfae3bf789a52a3763988dc6c309c67e8:
- task_66633bbf: questions and explicitly allowed Mac fixture-read capability in actual task POC. Owns experiments/remote-task-poc and task-poc.md. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_66633bbf, branch die/durable-questions-and-on-demand-mac-fixt-66633bbf.
- task_792d547d: true reply-loss gate and active-owner kill/restart, independent experiments/remote-failure-probe and failure-probe.md. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_792d547d, branch die/ambiguous-delivery-and-running-owner-fai-792d547d. Reuses prior actual-task owner read-only; integration must check it still fits questions worker changes.

Parent owns review/integration/push only after checks. Workers must commit, not push. Keep work bounded to experiments; user did not ask to publish releases, transfer real secrets or contact an unprovided remote machine. Runtime/model setup discovery is in remote-profile-discovery.md. Native questions versus lab-only dependency transport must be labeled accurately; no silent approval bypass.

## Round three failure review in parent

Failure worker returned 750ec0f, integrated as f525944. Parent removed machine-specific default binary paths, formatted source, counted actual downstream socket bytes instead of a constant, added gate socket deadlines and bounded page loop validation. First parent run reached replica check and failed: independent owner read observed tool-start after the earlier client sync, so cached replica legitimately lagged that read. Added explicit catchup before kill for this assertion; rerun in flight (task_8e9b646f, log /tmp/die-parent-failure-final.log). Do not call that first run a pass or the stale cache corrupt. Questions worker task_66633bbf is still active. Changes not pushed until the parent proof passes.

Parent failure rerun task_8e9b646f passed. See failure-probe.md for exact counts and fixed stale-cache assertion. Questions worker returned 9cc8f43; parent review identified terminal reply/resume guards and denial-before-question-answer behavior to tighten before integration/push.

## Round three integration ready

Question/capability commit9cc8f43 integrated as a874ca3; parent tightened terminal-state guards, denial-before-answer, typed payloads and record construction. Failure runner stages dependency.ts too; combined runner passed against the revised owner. Four task-PoC unit tests plus strict TS passed. Parent actual local SDK /questions command test also passed. Read-only scout task_f2bd8594 corrected the overly broad “RPC cannot answer” claim: command handler supports parent depth0 non-T3-native context, and SDK prompt routes commands. No authenticated remote native-question proof yet.

Next bounded discovery: actual RPC-native /questions answer through an authenticated test controller, plus real SSH tunnel/disconnect in Docker rather than HTTP-only transport. Local fixture-only dependency transport stays explicitly modeled. Do not confuse these decisions with real user approval, actual Mac access or paid-provider credentials.

## Round three pushed; round four active

Parent pushed validated failure checkpoint4440556, then dependency/terminal fixes e0526ab to origin/develop. No force push. Native local SDK command test passed. Final combined failure runner passed with revised dependency owner; its child task runner covers independent work, modeled question/local fixture grant and denial. User-facing /lab question remains modeled; real question service is next.

Round four base e0526ab4c6ffef5511be79c6d7ced06d7c114b1e:
- task_e5a84fc3: actual persisted harness questions through packaged RPC plus authenticated narrow controller. Owns experiments/remote-native-question-probe and native-question-probe.md. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e5a84fc3, branch die/native-persisted-question-over-remote-rp-e5a84fc3.
- task_6ca79168: real SSH tunnel and disconnect against disposable Docker sshd+existing task owner. Generated fixture client/host keys and private known_hosts only, strict checking, no user SSH keys/config modifications. Owns experiments/remote-ssh-probe and ssh-transport-probe.md. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_6ca79168, branch die/real-ssh-disconnect-transport-probe-6ca79168.

Parent must review, rerun and push finished pieces. Workers do not push. Both use staged CLI0.15.3 hash already recorded; repo0.15.4 metadata is distinct. No real remote host was supplied, so only disposable local Docker SSH authorized. No real provider credentials or paid requests. Loopback bearer does not isolate same-user agent code from controller secrets; security boundary not claimed.

Round four review: SSH worker9512bed integrated as9fab260, parent tightened key isolation/StrictModes and readiness measurement, actual SSH run passed. Native question worker9d4f747 integrated as04ac8f5; old CLI reproduced a real branch-ownership failure, not a transport absence. Fix worker task_24f46b27 returned a03b4d5 from /home/tnfssc/.die/worktrees/die-a86675007a5e-task_24f46b27, branch die/fix-native-question-ownership-across-dia-24f46b27. Parent reviewing source/fork safety and will rerun current artifact before pushing fix. Actual-transcript/Unicode worker task_cef0c7c6 remains active at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_cef0c7c6, branch die/actual-transcript-wire-and-unicode-probe-cef0c7c6, base04ac8f5.

## Native question and SSH integration follow-up

Question ownership fixes and retained transcript probe are integrated through 906a412. Parent reran 31 question tests, required-success packaged native-question Docker proof, and the transcript runner (four tests). Transcript sanitized fixture is 18,894 raw bytes / 6,923 batched gzip bytes; this is payload only, not wire traffic. No new value: ownership and honest proof already cover this round.

Next worker task_e64f49ce combines native questions with interrupted SSH in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e64f49ce, branch die/native-questions-over-interrupted-ssh-e64f49ce. Base 906a412. It must prove targeted answer and duplicate handling after tunnel reconnect, plus offline history. Fake provider only. Parent must review, rerun and integrate before pushing.

## On-demand repo follow-up

SSH/native-question hardening passed both parent runners and is pushed through d6e8649. Next: task_271b5bde probes exact code identity, explicitly selected dirty changes, isolated task checkout and safe result return in disposable Git repositories. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_271b5bde; branch die/on-demand-repository-identity-and-result-271b5bde; base d6e8649. No bulk environment sync or production API. Parent must review refusal paths, rerun, integrate and push. Values unchanged.

## Integrated CLI first slice

Discovery synthesis committed at 3218622. Worker task_2711fe5c builds a single experimental CLI flow (connect, launch, status, sync, offline transcript, native answer), reusing fixture pieces where possible. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_2711fe5c; branch die/integrated-remote-cli-experience-first-s-2711fe5c; base 3218622. Require human-readable commands, honest stale/unknown states, full retained events or explicit gaps, and fake-provider Docker proof. Capability and repo return are later slices in this same experience. Parent reviews/reruns before integration and push. No production remote support or actual Mac proof implied.

## User answers adopted; integrated flow continues

All seven saved replies read, recorded in user-decisions.md, then resolved as used. Base cb80112. Durable sync worker task_373d107c owns integrated CLI/server sync in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_373d107c, branch die/durable-transcript-in-integrated-remote--373d107c. Repo helper worker task_c62d3f48 owns experiments/remote-cli-experience/repo/ in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_c62d3f48, branch die/safe-automatic-repo-result-integration-h-c62d3f48. No overlapping CLI/server edits. Parent must review, integrate helpers into same user path, test combined Docker/native flow and push validated checkpoints. Mac capability and real host/provider validation remain after these slices.

Repo CLI wiring now task_abaac6b3 in /home/tnfssc/.die/worktrees/die-a86675007a5e-task_abaac6b3, branch die/wire-repo-handoff-into-integrated-cli-ex-abaac6b3, base 8f31ef9. Target actual die tool edit in task checkout through same pinned SSH CLI, then return safe patch or retained review artifact. Parent reviews/reruns before integrating. Durable sync/native parent checks passed; actual Mac/provider remains unproven.
