# SSH placement: normal human question bridge — 607d8168

Tree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c-a86675007a5e-task_607d8168
Branch: remote/task-placement-questions
Base: parent's remote/task-placement snapshot. Scope intentionally excludes src/agent/extension.ts and backend/task launch files.

## Implemented
- RemoteQuestionBridge projects actual native Question ledgers for tasks attributed by jobSessionFile into the parent's durable .questions.json. Keeps task/host/owner/epoch and native id/owner/version; no transcript-based answers and no fabricated child-clarification replies.
- Ordinary /questions answer saves explicit CLI human intent and a replyId before pinned client.control({op:"answer", ...}, {ownerId, epoch}). fsync before transport. Remote replies do not enqueue an unrelated local parent answer turn.
- Agent questions.ask/get/list can inspect or create ordinary questions, but resolve/cancel/block/setDelivery cannot mutate a remote human mirror; questions.answer remains unavailable through tools. A local lookalike ask cannot acquire a remote question identity.
- Stale modal/version rejected; saved reply's native version never retargeted. Sibling branches read-only. Optional durable jobQuestionOwner anchors first projection to the launch branch, even after late observation.
- Restart/offline outcomes remain saved/uncertain, never automatically replayed. Owner receipt or matching native delivered ledger reconciles loss. Explicit HUMAN /questions resume may retry precisely the same immutable request/replyId through the owner's idempotent receipt path; no fresh answer identity, no new command on a previously uncertain receipt.
- Terminal task makes leftover native questions history-only without pretending the native question ledger was cancelled/resolved. External native answered status does not synthesize local human answer text.
- Existing remote extension polling publishes question snapshots into the parent runtime via SessionManager-keyed observer; shutdown removes it. Progress/completion still use existing job observations/delivery.
- Owned jobSessionFile tasks excluded from routine remote inbox/footer (not diagnostic status). Unowned legacy tasks and diagnostic /remote commands remain.

## Exact integration required from lead / task worker
1. Immediately after the EXISTING shared client is created in src/agent/extension.ts, add:

   const remoteClient = new RemoteClient();
   questions.configureRemote(remoteClient);

   This uses the same pinned client as normal remote jobs. No agent-selected host, connection or credentials. The remote extension lifecycle already forwards snapshots; no second timer is required. If a parent runtime does not load that extension, its existing observation loop must call await questions.syncRemote(ctx, state) after cache refresh.

2. For safe first observation after parent branch navigation, commit an immutable jobQuestionOwner: { sessionId: ctx.sessionManager.getSessionId(), branchId: ctx.sessionManager.getLeafId()! } with normal launch intent, alongside jobSessionFile BEFORE SSH. Add that optional inline type to RemoteTask/client launch input and preserve/check it on same-ID launch retries. Bridge already consumes it structurally. Without it, first projection attaches to the current parent branch (jobSessionFile still pins the parent session); this fallback is NOT a proof of launch-branch attribution.

3. Destination native real-human questions must still use the actual QuestionService ledger and owner/version protocol; parent-directed child clarification stays normal context/completion. Do not transform an explicitly human ledger into an agent-answerable clarification. The bridge does not change destination role/depth policy.

## Permission/untracked seam deliberately not guessed
Capability needs and pre-launch untracked approvals are not native Question records and cannot safely become grants merely because a human or agent writes “yes”. This commit never approves untracked paths or calls grantCapabilities on prose.

Required next seam: trusted permission action metadata bound to immutable target task/owner/epoch, request ID, exact capability scope or source snapshot+path digest; ordinary saved human question with an explicit HUMAN command handler dispatching the bounded approval/grant. Agent resolve/cancel must never be an approval trigger. Revalidate snapshot/scope before granting and persist the same approval identity before transport. Pre-launch untracked inclusion needs the repository-preparation receipt/path list and parent question-owner anchor from the task/backend worker. Existing diagnostic human grant/repository commands remain explicit; owned-task capability needs are not claimed to be integrated into /questions by this bridge.

## Verification / environment
- Bun direct /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun; TMPDIR=/home/tnfssc/.die/tmp-pi-removal.
- Final focused run: tests/remote-question-bridge.test.ts, tests/questions-runtime.test.ts, tests/questions-extension.test.ts, tests/questions.test.ts, tests/remote-extension.test.ts: 83 pass, 0 fail. Includes 17 new bridge tests, real pinned RemoteClient.control with isolated fake receipt/transport, polling integration, concurrent claims, restart/lost reply, stale version/owner, siblings, human-only tools and terminal history. No full repeated suite.
- Typecheck --noEmit passes. Biome formatted owned files; git diff --check passes.
- Read-only shared dependencies were symlinked locally for validation. prepare-assets.ts was NOT run because it adapts shared dependency code; only required theme JSON and generated local package metadata copied to ignored runtime-assets for typecheck. No shared dependency mutation.
- No real host/config/cache/credentials, paid API, push or pnpm auto-install. Shell startup emitted an untrusted-mise warning; no config trust changed. All transport tests isolated fake state/temporary ledgers. No live SSH/terminal acceptance claimed.

## Reasons
Use one normal human ledger/UI and keep the remote owner receipt authoritative. Add only trusted projection, durable provenance and the explicit human reply dispatch seam; do not build a second lifecycle or infer permission from answers. Keep conservative unknown outcomes distinct from proven delivery. Do not silently weaken branch ownership on late observation: normal launch must pin the parent anchor.
