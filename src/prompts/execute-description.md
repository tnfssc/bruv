Run JS/TS code in current directory. A short plain `label` names the action, not an unverified result (for example, "Read task UI code" or "Run focused tests"). Source and output stay available on expansion.

## Code, output, and images

Top-level await, import/export, require(), Bun/Node/Web APIs, local modules, and installed packages all work. Access to files, workers, or network depends on the actual environment and result.

Bun.file, Bun.write, and node:fs handle files. shell() runs commands. subagent() starts another agent. These helpers are globals inside execute; do not import a bruv module to use them. Helpers return values, not printed output. Use console.log to show them. For example, `const r = await shell("pwd"); console.log(r.output);` prints a command result.

Text output up to 4,000 characters comes back directly. Longer output spills to files within a shared 10 MiB stdout/stderr capture limit. Set outputByteLimit per execution to change it; truncation is reported explicitly. You get a short preview and file paths.

`await showImage(image)` shows image to you. Pass file path, Blob, Uint8Array, Buffer, or ArrayBuffer. PNG, JPEG, and WebP work. Max 4 images per execute call. Input max 25 MB. Images over 5 MB resized automatically; original stays same. Output max 5 MB each, 10 MB together.

## Launch

`await shell(command, { waitSeconds?, timeoutSeconds?, closeInput? })`
`await subagent({ type?, prompt, title?, workspace?, target?, waitSeconds?, timeoutSeconds? })`
Use `prompts: string[]` instead of `prompt` to launch a batch.
- `type`: `"fast"`, `"normal"`, or `"orchestrator"`; defaults to `"normal"`.
- Fast/normal workers cannot delegate. Orchestrators can delegate to workers.
- Profiles choose the model and thinking level.
- `title`: optional readable task/thread name.
- `waitSeconds`: how long the call waits before returning a background job. Defaults: shell 3 seconds, subagent 1 second. 0 returns immediately.
- `timeoutSeconds`: optional limit on the whole job's runtime.
- `closeInput`: shell only; defaults to true. No more input coming. Need send input later with jobs.input()? Set false at launch. Closed input cannot reopen.

## Placement, workspace and source

- `target`: omit it or use `"local"` for the current runtime (server descendants stay on that server). An SSH name must exactly match the already human-pinned `connection.host`; agents cannot connect or choose arbitrary hosts. The reserved host name `local` uses the single alias `"ssh:local"`. Scoped native tasks reject explicit cross-placement rather than bypass backend policy.
- Named SSH subagents accept explicit `model: "provider/model"` and supported `thinking` overrides; omission uses the destination profile. These overrides are rejected for current-runtime and scoped-native launches rather than silently ignored.
- `workspace`: `{ kind: "inherit" }` (default) or `{ kind: "worktree", baseRef?, branch? }`. Worktrees need a Git repository. Local worktrees: no `baseRef` uses the parent's current commit; no `branch` makes a unique branch; a batch gets separate worktrees from one pinned commit. An explicit branch needs a single prompt. Workspace is independent of target. SSH transfers a tracked working-state snapshot into an isolated checkout, not Git history; explicit base selects that source, and untracked files require explicit human approval.
- Optional subagent `source: { includeUntracked: ["path"], retryTaskId? }` requests exact untracked inclusion through normal human questions. It grants nothing by itself. Launch returns a tracked pending job and source-approval retry task ID; after a saved human choice, retry unchanged intent with that same `source.retryTaskId`. Approved snapshot bytes stay pinned; current file changes are not silently recaptured. Omission is default. Explicit historical base plus current untracked inclusion is rejected, not silently reinterpreted.
- New worktree has setup configured? CLI runs the repository `t3.json` setup on its own. It does not ask for confirmation, trust, or approval, and does not start web. Web uses its configured project action. Worktrees and branches stay after completion or cancellation.
- SSH placement is async-only too (omit `waitSeconds` or use `0`); destination profile defaults apply, never laptop models. No `timeoutSeconds`: use `jobs.stop(id)`. It returns an `ssh:` job ID, workspace/snapshot provenance, and a durable ID even when the launch outcome is unknown. Auto refresh delivers progress/results; do not routinely call remote sync, inbox or answer helpers.
- Server-scoped native delegation? `subagent` is async-only. Leave out `waitSeconds` or pass `0`; positive values are rejected. The backend owns profile/depth policy and terminal delivery.
Only a human /remote connect authorizes and pins a named target. remote.status() is a backend diagnostic; readiness is not verified provider access.

Use subagent and jobs for ordinary task launch/progress/cancel/result, and /questions for human answers. Legacy remote.launch/launchRepository agent helpers reject rather than bypass task policy.

Only explicit human setup grants bounded parent-repo capabilities; no credential or whole-machine transfer. In an owned remote task, remote.requestCapability({kind,input,requestId?}) supports repo.read, tool:git-status, tool:git-diff and skill:name. Try destination tools first; missing grant or offline owner genuinely waits. Never infer permission or a human answer from worker text.

- Launch returns `{ id, status, exitCode?, output, background, ... }`.
- `background: false`: job finished; result is included.
- `background: true`: job still running; completion arrives later and resumes the agent.
- `await` waits for this launch response, not necessarily job completion.
- A nonzero exit is a failed job result, not a thrown exception.
- `await handoff(message)` shows message, gives user turn. Code after it no run. Normal reply with no tool call gives turn back too. handoff() does same from inside execute.

## Jobs

- `await jobs.targets()` — List current-runtime/local default and any saved human-authorized named target through the normal task surface. Cached authorization is not verified connectivity or provider access. No task setup ceremony.
- `await jobs.list({cursor?, count?})` — See your jobs. Default 20, max 100. Got cursor? Use for next page.
- `await jobs.inspect(id, {offset?, limit?})` — See job state, output, errors, child session path. Max 5,000 bytes. `nextOffset` gives next page.
- `await jobs.input(id, data, {closeInput?})` — Send input. Input stays open unless `closeInput: true`.
- `await jobs.closeInput(id)` — No more input coming. Job keeps going.
- `await jobs.stop(id)` — Stop one job with its exact listed ID.
- `await jobs.stopWork()` — Request cancellation of running jobs and async descendants scoped to this session, with its existing confirmation; reports per-job acknowledged/pending/errors and whether discovery completed. The host requests foreground cancellation only after that report reaches execute; a pending or partial result is not proof of exit.
Job still running? Attention message gives you turn to check it. Comes after 5 minutes with no activity, or every 10 minutes even if busy. Job keeps running.
- `await jobs.snooze(id, {minutes})` — Delay attention messages. More than 0, max 55 minutes.
- `await jobs.setWatch(id, {enabled})` — Attention messages on by default. `false` turns off, `true` turns on. Finish or fail still sends message.
- Session-owned SSH tasks appear as `ssh:<encoded taskId>` in jobs.list/inspect/stop/stopWork. Use the exact listed ID; remote methods keep raw taskId. SSH inspect is bounded cached output with staleness, not live status or a local process. Unknown or pending cancellation is not failure or exit. Offline stopWork may be partial/pending. SSH jobs reject input, closeInput, snooze and setWatch. Completion/actionable waits wake only the owning session through job delivery.
- Server-scoped native task IDs support list/inspect/stop. They reject input, closeInput, snooze, and setWatch. Native child runtime deadlines (`timeoutSeconds`) are not supported either; use `jobs.stop(id)` to cancel the child subtree. Local shell/CLI timeouts still work.
- Jobs started with shell() or subagent() may still run after execute ends, is cancelled, or hands off. jobs.list() shows their state.

## Human questions (parent CLI)

- `await questions.ask({text, dedupKey?, choices?, allowFreeText?, requester?, taskIds?, reason?})` saves a question and returns at once. Work that does not need it may continue. Reuse a short explicit dedup key for retries. Choices are strings; free text is allowed unless false.
- `await questions.list()` and `await questions.get(id)` read saved state. Keep the returned ID, owner and version for mutations.
- `await questions.block({id, owner, version, checkpoint, foreground?, taskIds?})` records which follow-up now needs the answer. Name the next step in checkpoint. Set foreground only if the parent cannot continue. This does not pause a child process. If no safe work remains, yield; no execute stack waits for the reply.
- `await questions.resolve({id, owner, version, reason})` closes a question after using its answer or when it is no longer needed. `await questions.cancel({id, owner, version})` withdraws it, not an answer or permission to guess.
- The user replies with /questions answer <id> <text>, not a tool or inferred transcript. A saved reply starts a new parent turn when safe, not code after an old await. Read the saved reply ID; do not repeat handled work. After a stop or reload, /questions resume <id> requests a new turn. Answer saved, queued, delivered and used are distinct.
- Live may ask and read the same state. Do not bind provisional or ordinary speech to a question. Targeted voice replies and web projection are not supported. A child returns routine clarification and its checkpoint to its parent through task results; the parent decides follow-up. Explicit human questions and new permissions use the human-owned saved question flow, never an agent-invented answer.

## History

- `await history.search({query, cursor?, limit?, excerptChars?})` — Find text in current conversation branch. Returns short matches and a `ref` for each.
- `await history.read({ref, cursor?, maxChars?})` — Read original text at that ref.
- Got `nextCursor`? Pass as `cursor` for next page.
- Other conversation? Add `sessionFile` and `allowCrossSession: true` to each call.
- `limit`: default 20 matches, allowed 1–50.
- `excerptChars`: default 240 characters, allowed 40–600.
- `maxChars`: default 8,000 characters, allowed 1–16,000.

## Live

- Live selection: `/live model` lists voice models across providers and selects the matching provider; `/live provider` configures credentials, not a model filter. Credential readiness is local, not verified API access.
- `await live.stop()` awaits this session’s mic/playback/provider teardown and preserves jobs. Read the result before saying it stopped; `stopped: false` includes teardown errors. If voice and work must both stop, await live.stop first, then jobs.stopWork(). Neither runs on ordinary speech interruption.
