# bruv rewrite: from a patched Pi distribution to a Pi package

Status: Implemented on branch rewrite/pi-package.
Date: 2026-10-10.

This document is the spec for the rewrite. Part 1 explains why. Part 2 lists the decisions that are
settled. Part 3 is the build spec. Part 4 is how we get there. If code and this document disagree,
fix one of them in the same PR.

---

## Part 1. Why

### 1.1 What the repo is today

bruv is five weeks old and has 2,635 commits (570 on 2026-10-07 alone). Size by area:

| Area | Lines | Notes |
|---|---|---|
| `src/` | 52k | 237 files |
| `tests/` | 101k | 491 files, 2x `src/` |
| `wisdom/` | 62k (23 MB, 1,931 files) | agent session notes, 460 JSON files, a 3 MB coverage JSON |
| `scripts/` | 30k | 159 files, ~20 orphans |
| `docs/` | 2.6k | 74 release-note files, `PRODUCT.md` marked "historical" |
| `patches/` | 1,060 lines + a 590 KB ghostty patch | edits to Pi's built `dist/` |

### 1.2 What the model actually uses

Measured from every tool call in local sessions since 2026-09-20 (3,145 sessions, 62,570 `execute` calls):

| Helper | Calls | Share |
|---|---|---|
| `shell()` | 35,126 | 56% |
| file reads via `Bun.file` | 19,946 | 32% |
| `rg`/`grep` in shell | 12,115 | 19% |
| file edits via read, `.replace()`, write | ~10,000 | ~16% |
| `jobs.inspect()` | 2,939 | 4.7% |
| `subagent()` | 997 | 1.6% |
| `handoff()` | 656 | 1.0% |
| `jobs.stop` / `jobs.snooze` / `jobs.list` | 269 / 253 / 200 | <0.5% each |
| `showImage()` | 232 | 0.4% |
| `questions.*` | ~120 total | 0.2% |
| `history.*` | 63 | 0.1% |
| `remote.*` | ~36 | <0.1% |
| `live.*` | 24 | <0.1% |

What the scripts look like:

- 62% of `execute` calls do exactly one operation. 26% do two or more. 12% do zero (pure JS
  filtering of a file or log).
- Multi-op use depends on the model: gpt-6.1-sol 37%, gpt-6-astra 43%, gpt-6-sol 13%, gpt-5.6-sol 11%.
- `Promise.all` appears in 0.4% of calls. Models do not fan out in parallel.
- Most batching happens inside the shell string: 74% of `shell()` strings chain with `&&` or `;`,
  45% use a pipe, 28% chain four or more commands.
- 36% of file edits run a test, typecheck or build in the same call. Edit-then-verify in one turn is
  the real win of scripting.
- 57% of the 5,922 replace-edits have no check that the text was found. `String.replace` silently
  does nothing on a miss, the file is written back unchanged, and the model believes it edited it.
  The user never sees a diff.
- The model polls `jobs.inspect` about three times per subagent. It does not trust the wake-up.

Where commit effort went (subject keyword counts): voice 393, release 241, T3 native 181, remote 167,
CI 124, web/browser 149. Execute, subagent, jobs and compaction together: about 80.

Conclusion: the core idea (one scripting tool, background work, subagents in worktrees, goals) is
right. Almost everything around it is unused weight.

### 1.3 Why scripting stays (the user's reasons, confirmed)

1. Models do more per turn when they can write a script. Measured: 26% overall, up to 43% on newer
   models, and edit-then-verify in one call 36% of the time.
2. Scripts can filter output before it reaches context.
3. New tools can be added mid-session without breaking the prompt cache. With normal tool calling, a
   new tool changes the tool list, which invalidates the cache on providers like OpenAI. Declaring
   every tool up front instead wastes tokens on every request.

Pi's `codemode` implements all three. Point 3 maps to `exposure: "deferred"`: the tool is callable
from scripts but is not listed in the codemode description, so the description and the cache stay
the same. Scripts discover it with `searchTools()`, `describeTool()`, `ALL_TOOLS`, or a one-line
message telling the model it exists. Pi already does this for MCP servers that connect mid-session
(`docs/mcp.md`, "Pi appends the new section to the conversation instead of changing tool
declarations, so earlier messages stay cached").

Today's `execute` description breaks rule 3 itself. It is 1,326 words, sent on every request, and
documents `questions`, `remote`, `live` and `history`, which together are used in under 0.3% of calls.

### 1.4 Problems found in the code

Self-reinforcing note loop:

- `src/prompts/wisdom.md` tells every root agent to write notes while working. That produced
  `wisdom/`: 62k lines in 18 days, with 460 files containing `/home/tnfssc/...` paths, 2,598 task
  IDs, 382 files with full commit SHAs, 496 files still naming the old product `die`.
- `wisdom/values.md` (~3,000 words) was built from those notes. It is half "grug" grammar, half
  formal, and starts by saying it should stay small.
- Agents read the values, become defensive about "proof" and "ownership", write defensive code, add
  tests that pin wording, and write more notes.
- The release gate executes scripts that live under `wisdom/claude-compat/proof/`.
- Agents also wrote CI logs into the user's home (`~/.bruv/ci-*.log`).

Pi is modified three ways at once:

- Bun patches to Pi's built JS (tree selector, mermaid, highlighting, `getEntryCountByType`, pi-tui
  performance work).
- `scripts/build/pi-host-adaptation.ts`: string `.replace()` on Pi's installed `dist/` files.
- 46 runtime prototype overrides, 22 of them in `src/history/session-manager.ts`, replacing about 17
  `SessionManager` methods and `AgentSession._runAgentPrompt`, `_buildRuntime`, `_checkCompaction`,
  `getContextUsage`. The patch adds `getEntryCountByType`; `src/history/selector-lifecycle.ts`
  overrides it again at runtime.
- Ten test files re-launch themselves in a child process because the prototype overrides are
  process-global.

Core runtime:

- Three compaction implementations (`native-compaction` 1,016 lines, `cache-affine-compaction`
  720, `manual-shake` 974) that import each other in a cycle. Behavior depends on hook registration
  order ("Registration order is policy").
- `agent/extension.ts` is a 1,069-line composition root with 53 imports, exported as
  `asynchronousTasksExtension`.
- Core imports voice, SSH and T3: `instruction-continuity.ts` imports `live/main-owner`, the editor
  imports push-to-talk, the footer imports voice cost, `job-service.ts` imports `remote/` and `t3/`.
- `tasks/task-lifecycle.ts` loads libc through FFI to `flock` a file that nothing reads.
- Diagnostics: 456 lines, a 54-code privacy allowlist, ring buffers, 49 call sites.
- Fast mode: 735 lines for a `service_tier` toggle. Cache countdown plus provider attempts: 485 lines.
- Questions: 1,547 lines of leases, epochs and fsync'd ledgers to ask the user something.
- Hidden wiring: `Symbol.for` properties on `AbortSignal`s, event-bus "RPC" with accept callbacks,
  29 `WeakMap`s keyed on Pi objects, 3 `AsyncLocalStorage`s, typed access to 10 private
  `AgentSession` members.
- 432 bare `catch {}` blocks, 91 `MAX_*` constants, ~35 env vars mostly used as parent-to-child IPC.
- Vocabulary: "owner" 634 times in `src/`, "projection" 78, "seam" 55, "authority" 43.

Peripheral systems (lines include tests and scripts):

| System | What it is | Size |
|---|---|---|
| `claude-compat` + `t3` | Pretends to be Claude Code's stream-json CLI so T3 runs bruv as a "Claude" provider. Second binary, release gate pinned to a T3 nightly. | ~32k |
| `live` + `native/` | Voice: Google plus two separate OpenAI stacks, a Swift/C helper. 12 core files import it. | ~28k |
| `remote` | Run the main agent or subagents over SSH. | ~24k |
| `web` | Ghostty-in-browser terminal multiplexer with tabs and drag reorder. Pulls in daisyui, sortablejs, ghostty-web. | ~11k |
| `scripts/terminal-perf`, `leak-audit`, `tui` proofs | Measurement tools not run by CI. | ~10k |

The user confirmed voice, remote and web were all attempts to talk to the agent from another device.
The user works over SSH and through T3 Code, where none of them reach. They go.

Tests: about 25-30% test behavior. About 40% assert exact strings (2,281 `toContain("…")`, a test
pastes `wisdom.md` and asserts the file equals the paste, a deleted sentence is asserted absent eight
times). About 30% test CI scripts, YAML text (135 checks) or the test harness itself. The "grug voice"
prompt rewrite touched 127 files, more than 50 of them tests.

User-facing text: `--help` lists `read`, `bash`, `edit` as built-in tools although only `execute`
exists, shows Pi env vars and `gpt-4o` examples. Internal words leak into about 30 messages
("Shake refused: opaque checkpoint damaged…", "Native Live belongs to another session owner").
`/mode fast` and `/fast on` do unrelated things. Two internal commands are visible.

Release notes: `docs/releases/release-v0.16.20.md` is 895 lines, 263 of them the same bullet.

---

## Part 2. Decisions (settled with the user)

| # | Decision |
|---|---|
| D1 | bruv becomes a **pure Pi package**: extensions plus prompts, installed with `pi install`. No bruv binary, no compiled build, no `bruv update`, no install script, no Pi patches. |
| D2 | In T3, bruv runs through **T3's built-in Pi driver**. claude-compat and the "bruv (not Claude)" provider are deleted. |
| D3 | Scripting runs on **Pi codemode**. bruv's own Bun `execute` runtime is deleted. |
| D4 | v1 keeps: background jobs, subagents with optional worktrees, goal mode, `/fast`, Codex native compaction, async questions. |
| D5 | Deleted: voice (`live`, `native/`), `remote`, `web`, `claude-compat`, `t3`, cross-session history search, cache-affine compaction, `/shake`, `/mode`, attention snooze/watch, diagnostics, task-lifecycle journal, the disk-backed session manager, `wisdom/`, `site/`, release tooling, perf harnesses. |
| D6 | One large PR from `rewrite/pi-package` into `develop`. Git history keeps everything deleted; nothing is archived as copies. |
| D7 | Prompts and all text use plain, short, normal English. Not "grug" grammar. |

### 2.1 Facts about T3's Pi driver that shape the design

Read from the installed T3 server (`0.0.46-nightly.20261005.2702`):

- Chat sessions run `<binaryPath> --mode rpc [launchArgs…] --extension <t3-mcp-extension>`.
  `binaryPath` defaults to `pi`. Extensions stay enabled. Only text generation uses
  `--no-extensions --no-tools`.
- T3 injects its own MCP tools (`delegate_task`, etc.) into Pi through that extension.
- **T3 stops the Pi session if Pi starts agent work outside an active T3 turn**:
  `"Pi started agent work outside an active T3 turn. The session was stopped to prevent invisible
  tool execution."` So background results must never start a turn on their own (`triggerTurn`) in T3.
  An explicit `/goal <objective>` or `/goal resume` command starts work with `sendUserMessage`.
- T3 supports steering during a turn, queued messages, structured questions (Pi extension UI
  dialogs over RPC), and fork/rollback.

Consequence: wait inside tools, and deliver results left running with the next message. See 3.4.

---

## Part 3. Build spec

### 3.1 Repository layout after the rewrite

```text
bruv/
  package.json            name "bruv", version 1.0.0, keywords ["pi-package"], "pi" manifest
  tsconfig.json
  biome.json
  bunfig.toml             only if tests need a preload
  extensions/
    bruv.ts               entry: registers every module below, nothing else (~60 lines)
  src/
    prompt.ts             system prompt wiring (~80)
    codemode.ts           codemode-only setup (~80)
    jobs.ts               background commands: registry, output files, stop (~350)
    agents.ts             subagent launch, profiles, result parsing (~350)
    worktree.ts           git worktree create + setup scripts (~120)
    settle.ts             reports results and reminds the model to wait (~150)
    goal.ts               /goal command, state, continuation, budget (~350)
    fast.ts               /fast priority tier (~100)
    usage.ts              ChatGPT plan limits and session use (~150)
    codex-compaction.ts   Codex native compaction (~350)
    questions.ts          async ask tool (~120)
    ui.ts                 widget, status, tool renderers (~200)
    config.ts             reads ~/.pi/agent/bruv.json (~60)
  prompts/
    system.md
    codemode.md           guidance + examples appended to the codemode tool description
    agent-fast.md
    agent-normal.md
    goal.md
    goal-continue.md
  tests/
  docs/
    REWRITE.md            this file
  .github/workflows/ci.yml
  AGENTS.md
  README.md
  CHANGELOG.md
  LICENSE
  t3.json
```

Line numbers are budgets, not targets. Total source budget: about 2,300 lines. Going over a module
budget needs a sentence in the PR description saying why.

`package.json`:

```json
{
  "name": "bruv",
  "version": "1.0.0",
  "type": "module",
  "keywords": ["pi-package"],
  "pi": { "extensions": ["./extensions/bruv.ts"] },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  }
}
```

Host packages go in `peerDependencies` with `"*"` and pinned copies in `devDependencies` for tests
and typechecking (`docs/packages.md`, "Declare dependencies"). No runtime `dependencies` unless one
is truly needed. Prompts are Markdown files read at load time relative to `import.meta.url`.

### 3.2 Prompts

`before_agent_start` adds bruv's guidance to `systemPromptOptions.sections.bruv`, preserving Pi's
context files (`AGENTS.md`), skills and tool sections. When codemode is active, the same section
includes the scripting examples. Pi keeps these sections during requests continued through
`agent_before_settle`. Goal state never changes the system prompt.

`prompts/system.md` (final wording may be tuned, keep it under 250 words):

```text
You're working with the user on their code, inside bruv.

- Clear request? Do it. Need a fact? Look it up before asking. Ask only for what you can't find.
- Do as much as makes sense in one script: read several files at once, edit and then run the
  check, start agents and wait for them together.
- Long work goes in the background (jobs and agents). Keep working while it runs, and call
  tools.wait for the results before you end your turn, unless you started it with detach.
- Prefer the simplest change that works. Each extra part, state or fallback is one more thing to
  break. Fix problems you can see, not ones you imagine. Security and data loss are the exceptions.
- Say what you checked, what you're guessing, and what's still broken.
- Have opinions. Recommend one path and say why. Push back when there's a better way.
- Don't keep old behavior just because it exists. Rebuild if that's simpler.
- Write like the surrounding code and docs: short, plain, no repetition.
- Scratch files go in `.tmp/` in the working directory. Don't write notes or logs into the repo
  unless the user asks.
```

`prompts/codemode.md` is included in the bruv system prompt section when codemode is active.
It contains three short examples and nothing else:

```js
// Read several files at once
const [a, b] = await Promise.all([tools.read({ path: "src/a.ts" }), tools.read({ path: "src/b.ts" })]);

// Edit, then check, in one script
await tools.edit({ path: "src/a.ts", oldText, newText });
return (await tools.bash({ command: "bun test tests/a.test.ts" })).output.slice(-2000);

// Start agents and wait for all of them
const { ids } = await tools.agent({ prompts: files.map((f) => `Fix lint errors in ${f}`) });
return await tools.wait({ ids, all: true });
```

`agent-fast.md`: "You are a fast sub-agent. Find the answer and show where it came from."
`agent-normal.md`: "You are a sub-agent. Build the solution, check it, and report what changed."
`goal.md` and `goal-continue.md`: rewrite the current `src/prompts/goal.md` and
`goal-continuation.md` in plain English, same meaning, under 150 words each.

Delete all other prompt files.

### 3.3 Codemode-only setup

Goal: the model sees one tool, `codemode`. `read`, `edit`, `write`, `bash` and bruv's tools are
callable from scripts only.

Pi does this with settings `"defaultTools": ["+codemode"]` and `"codemode": { "mode": "only" }`.
Extensions can read settings (`pi.getSettings()`) but cannot write them.

On `session_start`, if codemode is not active or `codemode.mode` is not `"only"`, show one notice:
"bruv works best with codemode only. Run /bruv-setup to turn it on." `/bruv-setup` asks for
confirmation, then writes `codemode.mode: "only"` and adds codemode to `defaultTools` in
`~/.pi/agent/settings.json`. It preserves other settings and existing explicit or relative tool
lists, then tells the user to `/reload`. In RPC mode (T3), the notice uses `ctx.ui.notify`.

bruv's own tools register with `exposure: "codemode"` (listed in the codemode description) or
`"deferred"` (callable, not listed). Rule: tools used often are `codemode`; rare tools and anything
registered after session start are `deferred`, grouped under a `namespace` whose `instructions`
hold the details.

### 3.4 Run model: wait inside tools

- Jobs and agents start work and return IDs. The model keeps working, then calls `tools.wait`
  for results before ending its turn unless the work was detached.
- Only `wait` and `job_start` with `waitSeconds` block. Their abort signal ends the wait at once
  on Esc or T3 Stop. They also return when `ctx.hasPendingMessages()` is true.
- Esc in the terminal and Stop in T3 behave the same: the run ends and every job and agent the
  session started is stopped, detached ones included. T3 restarts Pi after Stop, so its jobs end
  there anyway; the terminal does the same on purpose. On `agent_settled` with `aborted`, stop
  everything; the stopped results reach the model with the next message.
- `agent_before_settle` never waits. If `event.outcome` is `"aborted"`, it returns `{}`.
  Otherwise, it reports finished, unseen, non-detached items with one `bruv-report` entry per
  item and `continue: true`, marking each seen.
- If no result needs reporting but non-detached work still runs, continue once with a single
  `bruv-report` listing it and saying: "This work is still running. Call tools.wait to get the
  results, tools.job_stop to stop it, or end your turn again to leave it running; its results
  will come with the next message." Ending the turn again settles.
- Keep one `seen` flag per item and one `reminded` flag per session. Calling `wait`, `job_start`
  or `agent` resets the reminder. Results returned by `wait` or `job_start` count as seen.
- After settlement, new results are sent with `deliverAs: "nextTurn"` and shown in the UI.
  Detached jobs never cause reminders and deliver their results with the next message.
  bruv never uses `triggerTurn`.
- Result reports use `customType: "bruv-report"`, are rendered by `ui.ts`, and are capped at
  4,000 characters with output file paths for the rest.

**Verify first** (V1): codemode can wait for a job, steering releases that wait, and abort ends
it and the run within one second while the job keeps running. Its result arrives with the next
prompt. Pi awaits settle handlers even after abort, so settle must not wait.

### 3.5 Tools (all called from codemode scripts)

All parameters use TypeBox schemas. All tools declare `outputSchema` and return `structuredContent`
so scripts get objects, not text.

| Tool | Exposure | Input | Output |
|---|---|---|---|
| `job_start` | codemode | `{ command: string, cwd?: string, title?: string, waitSeconds?: number = 3, timeoutSeconds?: number, detach?: boolean }` | `{ id, status: "running" \| "done" \| "failed" \| "stopped", exitCode?, output, outputPath }` |
| `agent` | codemode | `{ prompt?: string, prompts?: string[], profile?: "fast" \| "normal" = "normal", model?: string, thinking?: string, worktree?: boolean \| { branch?: string, baseRef?: string }, title?: string }` | `{ ids: string[] }` |
| `wait` | codemode | `{ ids?: string[], all?: boolean = false, timeoutSeconds?: number = 600 }` | `{ done: Result[], running: Summary[], userMessagePending: boolean }` |
| `jobs` | codemode | `{}` | `{ items: Summary[] }` |
| `job_stop` | codemode | `{ id: string }` | `{ id, status }` |
| `ask` | deferred, namespace `bruv_questions` | `{ question: string, choices?: string[] }` | `{ id }` |
| `goal_update` | codemode | `{ status: "active" \| "blocked" \| "completed", progress?: string, evidence?: string, blocker?: string }` | `{ goal }` |

`Summary`: `{ id, kind: "job" \| "agent", title, status, startedAt, elapsedSeconds, outputPath, worktree? }`.
`Result`: `Summary` plus `exitCode?`, `output` (last 4,000 chars), and for agents `answer` (final
assistant text), `usage` (`{ input, output, cost }`), `sessionPath`.

`wait` returns as soon as one listed item finishes (or all, with `all: true`), when the timeout hits,
or when the user has sent a message. With no `ids`, it waits on everything this session started.

There is no `handoff`. In codemode the model ends its turn by replying.

### 3.6 Jobs (`src/jobs.ts`)

- Spawn with `child_process.spawn(shell, ["-c", command])` using `$SHELL` or `/bin/sh`, `cwd`
  defaulting to `ctx.cwd`, stdin closed.
- Output (stdout and stderr interleaved) goes to
  `<session dir>/bruv/<session id>/<job id>.log`. Keep the last 64 KB in memory for previews.
- IDs: `j1`, `j2`, … per session; agents use `a1`, `a2`, ….
- `waitSeconds`: wait up to that long before returning; if finished, return the final result.
- `timeoutSeconds`: SIGTERM, then SIGKILL after 5 s.
- `job_stop`: same SIGTERM then SIGKILL, on the process group (`detached: true` at spawn, kill
  `-pid`).
- `session_shutdown`: stop every job and agent this session started that is not detached. Detached
  jobs are stopped too when Pi exits. No orphans.
- The registry is in memory. After `/reload` or resume, previous jobs are gone; that is accepted.

### 3.7 Agents (`src/agents.ts`, `src/worktree.ts`)

- An agent is a child process: `pi --mode json --session <path> [--model m] [--thinking t]
  --append-system-prompt <path to agent-*.md> "<prompt>"`. `--mode json` runs the prompt, writes
  JSONL events to stdout, then exits (`docs/cli.md`). The binary is `process.env.BRUV_PI_COMMAND ?? "pi"` (tests override it).
- Child session files live at `<session dir>/bruv/<parent session id>/agents/<agent id>.jsonl`, so
  the user can open them with `pi --session`.
- The child loads bruv too, because the package is installed globally. The environment variable
  `BRUV_DEPTH=1` makes the child not register `agent` (one level of nesting only). `BRUV_FAST=1` is
  passed when `/fast` is on.
- Parse the JSON event stream for the final assistant text and usage. Stream progress (last tool
  name, token count) to the UI widget.
- Profiles come from `~/.pi/agent/bruv.json`:

  ```json
  { "profiles": { "fast": { "model": "openai-codex/gpt-6-luna", "thinking": "low" },
                  "normal": { "model": "openai-codex/gpt-6-astra", "thinking": "high" } } }
  ```

  Missing profile fields fall back to the parent's current model and thinking level. `model` and
  `thinking` on the call override the profile.
- `prompts` launches one agent per prompt. With `worktree`, each gets its own worktree.
- Worktree: `git worktree add -b <branch> <repo root>/.bruv/worktrees/<session short id>-<agent id> <baseRef or HEAD>`.
  Default branch name `bruv/<session short id>-<agent id>`. Add `.bruv/` to `.git/info/exclude` once.
  If `t3.json` in the repo root has scripts with `runOnWorktreeCreate: true`, run them in the new
  worktree before starting the agent, and fail the agent with their output if they fail.
- Worktrees and branches are never removed automatically. The result includes the path and branch.
- Cost: add each agent's usage into a session total shown in the footer.

### 3.8 Goal mode (`src/goal.ts`)

Port the behavior of the current `src/goals/` (pure extension code), simplified:

- `/goal <objective>` sets a goal. Optional flags: `--criteria "a; b"`, `--budget 2m` (tokens, accepts
  `k`/`m`). `/goal` shows status. `/goal pause`, `/goal resume`, `/goal clear`.
- State: `{ objective, criteria[], status: "active" | "paused" | "blocked" | "completed" |
  "budget_exceeded", tokensUsed, tokenBudget?, progress[], evidence?, blocker? }`. Save with
  `pi.appendEntry("bruv-goal", state)` when setting or clearing a goal, when its status changes,
  on `goal_update`, and once on `agent_settled`. Restore from the branch on `session_start` and
  `session_tree`.
- Count token use from assistant message usage while the goal is active. Update it in memory on
  `message_end`, refresh the status display, and save immediately only if the budget is reached.
- Setting or resuming an active goal sends `goal.md` plus the objective, criteria, and budget as
  plain lines through `pi.sendUserMessage`. This starts work directly from the command. If a run
  is already active, the message steers it. Resuming a spent budget does not start work.
- While the goal is active, its `agent_before_settle` handler continues after the earlier handlers
  have no entries or continuation to add. It sends a hidden `bruv-goal` custom message containing
  `goal-continue.md` and one status line: objective, tokens used / budget, and last progress.
- Stop continuing when: status is not active; budget reached (set `budget_exceeded`, tell the user);
  the model reports `blocked` with the same blocker three continuations in a row; or the run was
  aborted (pause the goal, tell the user `/goal resume` continues).
- The model calls `goal_update` to record progress, block, or complete. `completed` requires
  `evidence`.
- Goal instructions and changing state stay in conversation messages, preserving the system
  prompt and its cache. `/goal` shows plain lines for objective, status and token use, plus criteria,
  last progress, and blocker when present.

### 3.9 Async questions (`src/questions.ts`)

- `ask({ question, choices? })` opens a dialog without awaiting it (`ctx.ui.select` with choices,
  otherwise `ctx.ui.input`) and returns `{ id }` at once.
- When answered, the answer is delivered as a `bruv-answer` custom message: steer if the run is
  active, otherwise next turn.
- Unanswered questions do not make settle wait. Their answers arrive as described above.
- Without UI (`ctx.hasUI` false, print mode), `ask` fails with "No one can answer questions in this
  mode."
- **Verify first** (V3): a non-awaited dialog works during a run in the TUI and over RPC in T3.

### 3.10 `/fast` (`src/fast.ts`)

- `/fast` toggles, `/fast on`, `/fast off`. Save `fast: true|false` in `~/.pi/agent/bruv.json`,
  preserving other config fields. The default applies to future sessions and child agents.
- First time it is turned on, confirm: "Fast mode uses the priority tier. It is faster
  and uses more of your quota, including subagents. Turn it on?" Save `fastConfirmed: true` once accepted.
- Supported when the current model's API is OpenAI or Codex Responses. Otherwise: "Fast mode only
  works with OpenAI and Codex models." and stay off for that model without changing the saved default.
- `before_provider_request`: set `payload.service_tier = "priority"`.
- Child agents get `BRUV_FAST=1` and start with fast on, no confirmation.
- The footer shows `fast` while on.

### 3.10.1 `/usage` (`src/usage.ts`)

- Read ChatGPT plan limits from Codex stream events or response headers. Keep the latest
  snapshot per session and in `~/.pi/agent/bruv-usage.json` for startup.
- Show each window's used percentage in the footer. `/usage` adds bars, local and relative
  reset times, limit and credit status, rounded credits, and session tokens and cost.
- Warn once per session for each window at 90% and once when a limit is reached.
- Other models show session usage and explain that plan limits require a ChatGPT plan model.

### 3.11 Codex native compaction (`src/codex-compaction.ts`)

Port the essential behavior of `src/agent/native-compaction.ts` (read it with
`git show develop:src/agent/native-compaction.ts`). Budget 350 lines.

- Applies only when `ctx.model.api === "openai-codex-responses"`. Other models use Pi's default.
- In `before_provider_request`, capture the current Codex model and a copy of the rewritten
  request payload. In `before_provider_headers`, capture its headers. Do not copy conversation
  messages.
- Keep the latest Codex compaction entry in memory. Set it on `session_compact`; scan the branch
  once on `session_start` or `session_tree` to restore it. A later text compaction clears it.
- In `session_before_compact`, call the Codex responses endpoint with the remembered payload to get a
  `{ type: "compaction", id, encrypted_content }` item, exactly as the current code does (same URL
  resolution, headers, event parsing). Return a compaction with a short plain summary and
  `details: { strategy: "codex-native", version: 1, provider, model, item }`.
- In `before_provider_request`, when the saved compaction matches the current provider and model,
  put its item into `payload.input` where the summary text would be. Do not rescan the branch.
- If the model or provider changed since that compaction, use the plain summary and tell the user once.
- If the endpoint fails, cancel that compaction attempt, keep history, notify the user, and let Pi's
  default compaction run next time. No hidden retries.

### 3.12 UI (`src/ui.ts`)

Only when `ctx.hasUI`.

- Widget `bruv` above the editor: one line per running job or agent: `a2 Fix lint in foo.ts · 3m12s ·
  edit`. Agent progress shows the last tool or current token count. Completed items show their
  status and stay visible until the next prompt; hide them on the next widget update. Hide the
  widget when no items remain.
- This module sets only the total agent cost status. Fast and goal set their own status keys.
- Update the widget on creation, completion, stop, session reset, and a one-second timer, never on
  output chunks. Clear the widget, cost status, and timer at shutdown.
- Register renderers only in UI sessions. `bruv-report` and `bruv-answer` show the first content
  line when collapsed and all content when expanded. `agent` and `wait` show one status line per
  item; expanded results include recent output or the final answer, output path, and session path.
  Tool errors without result items keep their text.
- Wording rule: never show internal words (owner, native, opaque, checkpoint, projection, durable,
  bounded, seam, authority).

### 3.13 What is deleted

Delete these paths entirely:

```text
src/                      (all current code; the new src/ is written from scratch)
tests/                    (all current tests)
wisdom/
docs/PRODUCT.md docs/ARCHITECTURE.md docs/historical/ docs/releases/ docs/README.md
site/ native/ patches/ licenses/ scripts/
.github/workflows/dependency-updates.yml .github/workflows/live.yml .github/workflows/release.yml
bun.lock (regenerate)  bunfig.toml (recreate only if needed)  CONTRIBUTING.md (fold into README)
```

Old code stays reachable through git history (`git show develop:<path>`). Do not copy old files
into the new tree "for reference".

### 3.14 Tests

- Runner: `bun test`. Target under 60 seconds locally, total test code no larger than source code.
- Unit tests: job registry and stop, report formatting caps, profile resolution, worktree creation in
  a temporary git repo, goal state transitions and budget, fast payload change, codex payload
  rewrite (given a branch with a codex compaction entry, assert the request payload contains the item).
- Integration tests: create a Pi SDK session (`docs/sdk.md`) with the faux provider from
  `@earendil-works/pi-ai` and the bruv extension loaded. Cover: a codemode script calling
  `job_start` then `wait`; a finished unseen job reported through a continuation; one reminder for running work; a
  queued user message releasing `wait`; abort stopping the job and reporting it
  next turn; goal continuation stopping on budget.
- Agents: test with `BRUV_PI_COMMAND` pointing to a tiny fake script that prints a valid JSON event
  stream.
- Not allowed: asserting prompt or Markdown wording, reading source files as text, testing YAML,
  tmux, fixed sleeps over 100 ms, re-launching the test process.

### 3.15 CI

One workflow, `.github/workflows/ci.yml`, on pull requests and pushes to `develop`:
`bun install --frozen-lockfile`, `bunx biome ci .`, `bunx tsc --noEmit`, `bun test`. Linux only.
No release workflow: users install from git (3.16).

### 3.16 Install and migration

README install section:

```sh
# Install Pi (see https://pi.dev), then:
pi install git:github.com/tnfssc/bruv
pi            # then /bruv-setup once and /reload
```

For development: `pi install /path/to/bruv/checkout` (local packages load from the path, no copy).

Migration for the user (README section "Coming from bruv 0.x"):

- Sign in again with `/login` in Pi, or copy `~/.bruv/agent/auth.json` to `~/.pi/agent/auth.json`.
- Old sessions under `~/.bruv/agent/sessions` are not migrated.
- Move `~/.bruv/subagents.json` profiles into `~/.pi/agent/bruv.json` (format in 3.7).
- T3: enable the Pi provider (binary `pi`), disable the "bruv (not Claude)" provider.
- Remove the old binaries: `~/.local/bin/bruv`, `~/.local/bin/bruv-claude-compat`.

### 3.17 Repo rules for agents (`AGENTS.md`, under 60 lines)

- Read `docs/REWRITE.md` (until merged) and the module you touch.
- Module line budgets are in `docs/REWRITE.md` 3.1. Over budget needs a reason in the PR.
- Do not write notes, logs, evidence or "proof" files into the repo. Decisions go in the PR
  description. Scratch goes in `.tmp/` (ignored).
- Tests follow 3.14. No wording assertions.
- Plain English. Banned in code identifiers, comments and user-facing text: owner, ownership,
  authority, seam, projection, durable, bounded, canonical, opaque, admission, "not proof".
- No prototype patching of Pi. If Pi lacks a hook, open an upstream issue and work around it in the
  extension.
- Squash-merge PRs. Commit messages: one imperative line, optional short body.

---

## Part 4. Plan

### 4.1 Verify first (spikes, results go in the PR description, not in files)

| ID | Question | Fallback |
|---|---|---|
| V1 | Does codemode `wait` return on completion, steering and abort, with abort ending the run within 1 s? | Keep all waiting in tools; settle only reports or reminds (3.4). |
| V2 | How can a package turn on codemode-only mode? | `/bruv-setup` writes settings (3.3). |
| V3 | Does a non-awaited `ctx.ui.select` dialog work during a run, in TUI and over RPC? | `ask` blocks the script until answered. |
| V4 | Does system-prompt framing from `before_agent_start` survive `continue: true` requests? | Keep static guidance in structured system prompt sections. |
| V5 | Does `pi --mode json --session <new path>` create and keep the child session file, and does the child load bruv from the global install? | Pass `--extension <package path>` explicitly. |

### 4.2 Phases

Each phase ends with a commit on `rewrite/pi-package` and green `bunx biome ci . && bunx tsc
--noEmit && bun test`.

1. **Clear and skeleton.** Delete everything in 3.13. Add the new `package.json`, `tsconfig.json`,
   `biome.json`, `extensions/bruv.ts`, `src/prompt.ts`, `src/codemode.ts`, `src/config.ts`, the
   prompts, CI workflow, `AGENTS.md`, a short `README.md`. Run spikes V1-V5 and report results.
   Acceptance: `pi -e ./` loads the package with no errors; the model-facing prompt contains bruv's
   guidance; tests green.
2. **Jobs, agents, settle, UI.** `jobs.ts`, `agents.ts`, `worktree.ts`, `settle.ts`, `ui.ts` and
   their tests. Acceptance: integration tests in 3.14 for jobs, reminders, wait, steer release and abort pass.
3. **Goal, fast, codex compaction, questions.** With tests. Acceptance: unit and integration tests
   pass.
4. **Finish.** README (install, commands, tools, config, migration), `CHANGELOG.md` with one entry
   for 1.0.0, `t3.json` updated (setup script: `bun install --frozen-lockfile`), final size check
   against budgets. Acceptance: total source no more than ~10% above 2,300 lines; smaller is fine.
   One real smoke run in T3 is done by the reviewer.

### 4.3 Risks

- T3's Pi driver is in a nightly. If it changes how it treats long turns, the tool-wait model needs
  another look.
- Codemode runs scripts in QuickJS: no direct `fs`, network or npm. Anything needing those goes
  through `tools.bash`. The usage data says that is rare.
- Losing auto-wake after the user's turn ends is a deliberate trade for T3 compatibility.
- Pi upstream gaps worth filing as issues (not blockers): a hook to write settings from a package;
  `before_provider_request` able to block.
