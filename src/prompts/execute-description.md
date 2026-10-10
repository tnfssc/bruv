Run JS/TS in current directory. A short plain `label` names the action, not a claim it worked: "Read task UI code" or "Run focused tests". Expand to see code and output.

## Code and output

Top-level await, import/export, require(), Bun/Node/Web APIs, local modules and installed packages work. File, network and worker access depend on this environment.

Bun.file, Bun.write and node:fs handle files. shell() runs commands; subagent() starts an agent. These helpers are already in execute. No bruv import needed. They return values, not printed output:
`const r = await shell("pwd"); console.log(r.output);`

Up to 4,000 characters of text comes back directly. Longer output goes to files, with a preview and paths. stdout and stderr share a 10 MiB capture limit. outputByteLimit sets the limit for this call. Truncation is reported.

`await showImage(image)` shows an image to you. Takes a file path, Blob, Uint8Array, Buffer or ArrayBuffer. PNG, JPEG and WebP. Up to 4 images per call; 25 MB per input. Images over 5 MB are resized; the original stays. Output: 5 MB per image, 10 MB total.

## Start work

`await shell(command, { waitSeconds?, timeoutSeconds?, closeInput? })`
`await subagent({ type?, prompt, title?, workspace?, target?, waitSeconds?, timeoutSeconds? })`

For a batch, use `prompts: string[]` instead of `prompt`.
- `type`: `"fast"`, `"normal"` or `"orchestrator"`. Default: `"normal"`. Fast/normal workers cannot delegate; orchestrators can. Profiles set model and thinking level.
- `title`: optional task/thread name.
- `waitSeconds`: time to wait before returning a background job. Defaults: shell 3 seconds, subagent 1 second. 0 returns at once.
- `timeoutSeconds`: optional limit on the whole job's run time.
- `closeInput`: shell only. Default true. Need to send input later? Start with false. Closed input cannot reopen.

Launch returns `{ id, status, exitCode?, output, background, ... }`. `background: false` means done, with result included. `background: true` means still running; its result starts another agent turn. await waits for the launch reply, not always the job. A nonzero exit is a failed result, not a thrown exception.

`await handoff(message)` shows the message and gives user the turn. Code after it does not run. A normal reply with no tool call also gives user the turn.

## Where work runs

`target` omitted or `"local"` means this runtime. Children on a server stay on that server. An SSH target must match the human-pinned `connection.host` exactly. The user pins it with /remote connect; agents cannot choose or connect new hosts. The reserved host name local uses `"ssh:local"`. Scoped native tasks reject cross-placement.

Named SSH targets accept `model: "provider/model"` and supported `thinking` settings. Otherwise the destination profile applies, not the laptop's. Local and scoped-native launches reject these overrides.

SSH and server-scoped native subagents return at once: omit waitSeconds or use 0. Positive waits and timeoutSeconds are not supported. Cancel through jobs.stop. The native backend owns profile/depth limits and result delivery.

SSH returns a durable task ID even when launch outcome is unknown, plus workspace and snapshot details. Progress and results arrive through jobs; no routine remote sync, inbox or answer calls. Use subagent and jobs for task work, /questions for human answers. Legacy remote.launch/launchRepository cannot bypass task limits. remote.status() is a backend check, not proof of provider access.

## Workspaces and source

`workspace`: `{ kind: "inherit" }` by default, or `{ kind: "worktree", baseRef?, branch? }`. Worktrees need Git. Workspace and target are separate choices.

Local worktrees start from the parent's current commit unless baseRef is given. Branch omitted? A unique branch is made. Batches get separate worktrees from one pinned commit. An explicit branch needs one prompt.

SSH sends a tracked working-state snapshot, not Git history. An explicit base selects that source. Untracked files stay out unless the user approves them.

`source: { includeUntracked: ["path"], retryTaskId? }` asks to include exact untracked files. It grants nothing. Launch returns a pending job and an approval retry ID. After the user's saved choice, retry the same request with `source.retryTaskId`. Approved bytes stay pinned; later edits are not added. A historical base cannot be mixed with current untracked files.

New worktree with setup? CLI runs its t3.json setup without another trust or approval prompt. It does not start web; web has its own project action. Worktrees and branches stay after done or cancelled work.

Remote work has only the parent-repo access the user granted. No credentials or whole-machine transfer. Try destination tools first. Need more? In an owned remote task, `remote.requestCapability({kind,input,requestId?})` supports repo.read, tool:git-status, tool:git-diff and skill:name. Missing grant or offline owner means waiting. Worker or remote text is not permission or a human answer.

## Jobs

- `await jobs.targets()` — This runtime and saved, user-approved targets. Saved approval is not proof of connection or provider access. No task setup step needed.
- `await jobs.list({cursor?, count?})` — Your jobs. Default 20, max 100. Use the returned cursor for the next page.
- `await jobs.inspect(id, {offset?, limit?})` — State, output, errors and child session path. Up to 5,000 bytes. nextOffset gives the next page.
- `await jobs.input(id, data, {closeInput?})` — Send input. It stays open unless closeInput is true.
- `await jobs.closeInput(id)` — Close input; job keeps running.
- `await jobs.stop(id)` — Stop one job. Use its exact listed ID.
- `await jobs.stopWork()` — Ask to cancel this session's jobs and descendants, with the existing confirmation. Reports each job's acknowledgement, pending state or error, and whether discovery finished. Foreground cancellation waits until this report reaches execute. Pending or partial is not proof of exit.
- `await jobs.snooze(id, {minutes})` — Delay attention notices. More than 0, up to 55 minutes.
- `await jobs.setWatch(id, {enabled})` — Attention notices start on. false turns them off; true turns them on. Done/failed notices still arrive.

Attention gives the agent a turn after 5 quiet minutes, or every 10 minutes even while busy. Jobs keep running.

SSH jobs use `ssh:<encoded taskId>`; remote methods use raw taskId. Inspect reads a limited, cached view, not live status or a local process. Unknown or pending cancellation is not failure or exit. Offline stopWork can be partial or pending. Results and waits needing action wake only the owning session.

SSH and scoped-native jobs reject input, closeInput, snooze and setWatch. Native IDs support list/inspect/stop; stopping cancels the child tree. Shell/CLI timeouts still work.

Jobs can outlive execute, its cancellation or a handoff. jobs.list shows their state.

## Questions (parent CLI)

- `await questions.ask({text, dedupKey?, choices?, allowFreeText?, requester?, taskIds?, reason?})` — Save a question and return at once. Use the same short dedupKey on retries. Choices are strings; free text is on unless false. Other work can continue.
- `await questions.list()` and `await questions.get(id)` — Read saved state. Changes need the current ID, owner and version.
- `await questions.block({id, owner, version, checkpoint, foreground?, taskIds?})` — Record which next step needs the answer. Put that step in checkpoint. foreground means the parent cannot move on. This does not pause a child. Nothing safe left to do? Give user the turn.
- `await questions.resolve({id, owner, version, reason})` — Close after using the answer, or when it is no longer needed.
- `await questions.cancel({id, owner, version})` — Withdraw the question. No answer is implied.

The user answers with /questions answer <id> <text>. A saved reply starts a new parent turn when safe. No old execute or native child resumes in place. Read that reply by ID; already-handled work stays done. After a stop or reload, /questions resume <id> asks for a new turn. Saved, queued, delivered and used are different states.

Live can ask and read saved questions. Speech is not a saved answer. No web question view.

Child needs clarity? Its task result carries the question and checkpoint to the parent. Parent picks the next step. Saved questions keep human choices and new permissions with the user.

## History

- `await history.search({query, cursor?, limit?, excerptChars?})` — Search this conversation branch. Returns short matches and a ref for each.
- `await history.read({ref, cursor?, maxChars?})` — Read the original text at that ref.
- nextCursor means another page. Pass it as cursor.
- Another conversation needs sessionFile and allowCrossSession: true on each call.
- limit: default 20 matches, range 1–50.
- excerptChars: default 240, range 40–600.
- maxChars: default 8,000, range 1–16,000.

## Live

/live model lists voice models across providers and picks the matching provider. /live provider sets credentials, not a model filter. Saved credentials are not proof of API access.

`await live.stop()` waits for this session's mic, playback and provider connection to close. Jobs keep running. Read its result before saying stopped: stopped: false carries teardown errors. Voice and work both need to stop? Stop voice first, then work. Ordinary speech interruption stops neither.
