# pi-acp-only root lifetime feasibility (2026-10-03)

**Result: a bounded local-job adapter-only route works. Not a migration or production acceptance.**

Read with [values](../values.md), [registry review](registry-followup-review.md), [pi-acp peer](pi-acp-peer.md), [Bruv through pi-acp](bruv-through-pi-acp.md), [filtered trial](t3-bruv-filtered-trial.md), and [deep probes](t3-deep-probes.md). This narrows the earlier late-run failure; it does not erase the other gaps.

## Exact scope / provenance

Only an isolated checkout of maintained **pi-acp 0.0.34, b0581c9c1d675e634234674484247008b03d69b4**, was modified/built. Parent source at .cache/acp-pi-peer/source was read-only. Experimental opt-in: PI_ACP_BRUV_PROTOTYPE=1. No Bruv product source, T3 source, binary, existing bundle, or parent runtime was changed; no push/publish. The tracked contribution is [adapter.patch](prototypes/pi-acp-only-lifecycle/adapter.patch), proof scripts and this feature wisdom, not node_modules/distributions.

Official compiled T3: .cache/acp-t3-upstream-experience/platform/t3. Existing compiled Bruv: dist/bruv. Both hashes exactly match the earlier filtered trial: T3 **2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795**, Bruv **5da33808892cf3c28ea9816a2e2271c183ddbcd792f7a2893483a40fcde13965**. See selected hash proof.

T3 registered the real official **pi-acp** ID through its supported executable override, pointing to the experimental build, labelled **Bruv pi-acp fork — ADAPTER-ONLY PROTOTYPE**. This is not a newly published Bruv registry identity. Fresh project, home, T3 base, browser context, model fixture and loopback port were owned by this worktree. Read-only prior filtered scripts were templates only.

## Small policy, real typed boundaries

1. Adapter child launch removes all T3_/T3CODE_ controls (including T3_ACP_MCP_AUTHORIZATION/ENDPOINT/NODE), Electron/Vite controls, and enables BRUV_WEB_TASK_EVENTS=1. T3 itself retains its own environment and remains byte-identical. No external filter launcher is needed.
2. Existing src/t3/tasks/events.ts **does emit** bruv_task_event started/completed over RPC in the unchanged compiled binary, without native routing. Source and actual wire corroborate this.
3. Lifecycle telemetry includes synchronous commands too. Use **execute tool result details.backgroundJobs** to distinguish real background launches. A synchronous completion must not leave a permanent work debt.
4. A completed job remains a delivery debt until an actual **message_end, role=custom, customType=task-complete, details.tasks[].id** consumes it. Bruv's CompletionBatcher delays notification delivery; completion alone is not quiescence. Settle only at agent_settled after all background/delivery work drains and serialized ACP output flushes. No idle timeout, textual matching, synthetic provider prompt, or model poll determines adapter lifetime. Auxiliary usage RPC is retained, not a continuation poll.
5. Genuine concurrent prompt callers are forwarded using existing RPC streamingBehavior=steer and owned until drain; preflight failures reject their caller, rather than falsely returning end_turn. Current/queued error owners are all settled. A new input arriving during cancellation is queued for a new owner, never joined to the cancelled promise.
6. Stop aborts foreground and resolves the ACP request as cancelled, **not jobs.stopWork or managed-subtree shutdown**. Prototype explicitly says this in its output.

Only local shell jobs/typed local completions were proved. This tracker is not an arbitrary goal, question, remote/native-job or durable continuation detector.

## Real browser/history proof

Selected credential-free bundle: [proof/pi-acp-only-lifecycle](proof/pi-acp-only-lifecycle/README.md).

Final clean :18783 run launched real compiled Bruv shell("sleep 18; ...", {waitSeconds:0}), returned an early assistant answer, submitted a user follow-up while the job was alive, and used T3's **Steer** button. Bruv produced the follow-up answer and then its normal automatic task-complete continuation. T3 history retained **both** CONCURRENT_FOLLOWUP_COMPLETE_FILTERED and AUTOMATIC_LATE_COMPLETION_OBSERVED_FILTERED, plus the user input, in **one original completed run** (ordinal 1, 22.771s). The staged queued run (ordinal 2) was cancelled by T3's steer mechanism; it did not become a second active answer run. Steer supersedes a provider attempt via cancel+new real prompt; it is not a purely additive UI operation. Early attempt output remains in history/partial-attempt projection.

Working/Stop was present while the shell was owned. After drain, Working became Worked; late file diff appeared. Browser reload retained both answers, follow-up input and file diff (11/12 snapshots). There was no fake polling: model trace has the genuine user/tool exchange, genuine follow-up and genuine task-complete notification only.

Live Stop: snapshot 17 shows Working with a real job already started; 18 shows interrupted-by-user and the explicit foreground-only warning. The unchanged detached shell subsequently completed and wrote **stop-survived.txt**; 19/20 retain interrupted state across reload. This proves **Stop does not stop managed jobs**. Automatic post-Stop output has no active ACP/T3 run and is not promised retained. An earlier Stop-before-provider-start attempt is retained in private history but is not used as the live-job proof.

Credentials: names-only adapter trace records removal of real T3 ACP variable names. /proc inspection of owned compiled Bruv **and live bounded shell descendants** during clean replay found zero T3_/T3CODE_ names. No values were exported. T3 MCP descriptors remain accepted/ignored by upstream pi-acp: **NO MCP tools parity, task bridge, question bridge, or full credential-handling acceptance is claimed.**

173 tests passed, including background-vs-foreground debt, typed delivery, auxiliary-event settlement, concurrent owners, cancellation/input ownership and preflight error propagation; typecheck/build passed. Clean consolidated replay in .cache/pi-acp-only-proof.KwX64N exited 0; projection assertions independently passed. Original final proof used .cache/acp-adapter-only/final. Earlier bounded failed iterations are retained privately: counting synchronous telemetry held a prompt forever; counting auxiliary UI events invalidated settlement; joining cancel-racing input lost its new owner. Final patch fixes those actual failures. Do not copy the first failed action sequence as the recipe.

## Reproduce / limits

With Node/npm on PATH, available Chromium/Playwright, parent read-only assets and registry network access:

    BRUV_PARENT_REPO=/home/tnfssc/Code/bruv PROOF_PORT=18784 \
      wisdom/acp/prototypes/pi-acp-only-lifecycle/run.sh

Optional PLAYWRIGHT_MODULE and CHROMIUM_BIN override research installations. Script clones the exact commit, applies the patch, uses its own npm cache, builds/tests only the adapter, creates a fresh ignored runtime, runs real official T3/browser, exports bounded assertions and shuts down. Scripts preserve runtime/evidence; **do not publish .cache wholesale**, which contains local pairing/auth state and private logs. Selected proof excludes those. Initial exploratory npm installs used the host download cache; clean replay uses a worktree-private npm cache. No bundle removed.

Both initial and clean-replay owned T3/browser servers exited, and :18782/:18783/:18784 listeners were closed. No paid provider/auth run, full tool projection, MCP execution, durable human questions, remote/native graph, backend restart during work, >50 completion records, or crash recovery was accepted. Reload here means **browser page reload**, not a backend restart. T3 may withhold rendering early assistant text until the prompt finishes, merges continuation text, and uses generic Tool presentation; this is not smooth-native UX parity. Long-lived/watch jobs can keep Working indefinitely by design. No fallback idle timer should hide a missed typed delivery.

An independent contract reviewer must be attached by the parent task; this normal worker cannot delegate and does not claim independent sign-off. ACP v1 keep-open evidence is enough for this feasibility spike; it is not draft-v2 conformance or permission to remove packaged T3.

Values unchanged: single ownership, actual-path proof, honest boundaries already apply. New lesson belongs with this feature: combine typed launch disposition, lifecycle and delivery acknowledgement; lifecycle alone is insufficient.
