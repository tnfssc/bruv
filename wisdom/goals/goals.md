# Goal mode

Goal mode is opt-in. It keeps one objective and optional acceptance criteria in the
active session branch. Each model turn gets saved state. It requests another turn
while useful work remains. It does not prove the objective is right or make the
provider deterministic. Model-written evidence is not independent proof.

## Start and control a goal

In T3 Code or the interactive TUI, start with an objective:

```text
/goal Create the report
```

Use `set` when you want to add criteria, constraints, or a token budget:

```text
/goal set Create the report --criteria report.md exists; links were checked --constraints do not publish; keep source files unchanged --tokens 50000
```

Only the objective is required. Semicolons split criteria and constraints; omit
either when unnecessary. `--tokens` accepts a positive integer and is optional.
T3 Code also accepts `/bruv goal ...` and `/bruv:goal ...`.
Goal mode starts through `/goal set` or an explicit user request handled with the
helper below. Ordinary tasks do not create persistent goals or automatic goal
continuations. An unfinished goal cannot be silently replaced; clear it first.

| Command | Behavior |
| --- | --- |
| `/goal` or `/goal status` | Display the current branch's goal, status, and token usage. |
| `/goal <objective>` | Start a new persistent goal. |
| `/goal pause [reason]` | Persist a paused state, interrupt the current agent turn, and stop automatic continuation. |
| `/goal resume` | Start a fresh blocker audit and request a continuation, preserving token usage. An exhausted budget prevents resume. |
| `/goal budget <N\|none>` | Set a positive integer budget or remove it without resuming the goal. |
| `/goal clear` | Interrupt the current agent turn and append a durable clear marker on the current branch. |

In T3, use `/bruv goal status`, `/bruv goal pause`, and `/bruv goal clear` while
the agent is responding. T3 rejects steering bare `/goal` commands before they
reach Bruv; the native Stop button also pauses the goal. Bare commands work when
idle. Clear before replacing a goal, and pause before changing its budget.
Pausing with the goal command leaves existing jobs running; use job controls to
stop them. T3's native Stop also closes the connector, which tears down its owned
work.

Goal records are custom entries in normal session JSONL. They survive process
restart. They follow Pi's branch semantics. Moving to another branch restores latest
valid goal entry there. Malformed or unsupported newer goal entry fails closed. It
does not revive old state.

## Helpers available to the agent

Goal helpers work only inside `execute`, next to `shell`, `subagent`, and `jobs`.
The brief API is always discoverable in `src/prompts/execute.md`. Additional guidance
in `src/prompts/goal.md` comes with saved goal state, including non-active states.
Start, update, and clear do not change the system prompt or tool definitions. Only
the goal context message changes. This preserves the system prefix; it does not
promise a provider cache hit.

Helpers:

```ts
const current = await goal.get();
await goal.set({
  objective: "Create the report",
  criteria: ["report.md exists", "links were checked"],
  constraints: ["do not publish"],
  tokenBudget: 50000, // Only when explicitly supplied by the user.
});
await goal.update({ status: "active", progress: "Drafted report.md" });
await goal.update({ status: "blocked", blocker: "Missing source data" });
await goal.update({ status: "paused", reason: "User asked to pause" });
await goal.update({ status: "completed", evidence: "Read report.md and checked 12 links" });
await goal.clear();
```

`goal.get()` returns the current goal or `null`. `goal.set()` needs an objective;
criteria and constraints are optional. Omitted criteria default to the objective;
omitted constraints default to an empty list. Only an explicit user request authorizes
creating a persistent goal. An existing unfinished goal must be cleared before
replacement. `goal.update()` accepts `active`, `blocked`, `paused`, or `completed`.
Completion needs verified `evidence`. Blocking needs a `blocker` and the three-turn
audit below. Pause only on an explicit user request; `reason` records why. Active
updates may add one checked `progress` milestone, but are not required keepalives.
`goal.clear()` appends a durable clear entry.

`waiting`, `pendingJobIds`, `tokensUsed`, and `budget_exceeded` are runtime-owned
state. The agent cannot set usage, change a budget through updates, or use an active
update to bypass a paused, blocked, or exhausted goal. Budget changes and resume
belong to the user.

Successful explicit `handoff()` with active goal and running jobs saves all owned
running IDs. Goal changes to `waiting`. This is only automatic path to waiting.
Ordinary replies do not trigger it. Runtime does not guess dependencies on persistent
services or other jobs. Any tracked job settles? Goal returns to `active` and can
continue. Jobs belong to process. JSONL does not rebuild them. Resume session with
waiting goal but missing IDs? It pauses. Check what remains. Use `/goal resume` only
when safe.

## Evidence and automatic-continuation limits

Goal state is bounded so it cannot become an unbounded evidence store:

- objective, criterion, constraint, completion evidence, blocker, and pause-reason
  fields are at most 4,000 characters each;
- criteria and constraints contain at most 20 entries each;
- up to eight distinct progress milestones are retained, each at most 500 characters;
- the aggregate textual goal payload is at most 12,000 characters.

These limit storage, not promise quality. Completion evidence is a short model-written
claim. Check the objective and acceptance criteria with tests, files, or outside
review before completing it. A partial result or nearly exhausted budget is not
completion. Turns without a progress milestone continue normally.

A blocker must recur for three consecutive goal turns, including the original turn,
before the runtime records `blocked`. Earlier reports keep the goal active so the
agent can try alternatives and finish independent work. Repeated calls in one turn
do not count as separate turns. A different blocker, checked progress, user steering,
or `/goal resume` starts a fresh audit. Do not mark work blocked just because it is
hard, slow, uncertain, or would benefit from clarification.

User steering and questions keep the goal alive. The agent answers a status question
briefly, then continues the objective. An explicit Stop/abort pauses continuation;
a provider retry that succeeds does not. Saved foreground questions still defer work
that requires an answer.

In native T3, the connector sends dedicated synthetic goal messages so the host can
show its goal indicator. Scheduled automatic turns share one native run, including
initial command admission and provider startup, so Stop and steering retain their
owner. The final result aggregates actual model usage across those turns. Pausing,
waiting, or exhausting a budget settles the run with a non-completion terminal
reason; unrelated chat while paused cannot complete the saved goal. Only actual
completion permits the native completed indicator. Human command notices are
synthetic and do not count as model work or usage.

T3 2702's Claude provider protocol supports a saved-goal indicator and completion,
but not Codex's structured paused, blocked, or budget fields. An unfinished idle
goal therefore displays **Goal set**. `/goal status` reports Bruv's precise state
and usage; `/goal resume` resumes it. The native Clear control clears the durable
Bruv goal. This limitation cannot be fixed by changing Bruv's wire data alone.

## Token budgets

The default is no token budget. Set one only when the user explicitly supplies it,
using `--tokens N` at creation or `/goal budget N` later. `goal.get()` exposes
`tokenBudget` when configured and cumulative `tokensUsed`. Usage includes
provider-reported input, output, and cache tokens for this agent's turns while the
goal runs. It does not claim to include delegated work, and missing provider usage
cannot be counted.

The runtime checks usage after each provider response and records `budget_exceeded`
when the budget is exhausted. It stops before the next tool or provider request.
One response can use more than the remaining budget; this is not a hard provider
token cap. Changing or removing the budget does not silently resume work. Use
`/goal resume` afterward. Resume preserves cumulative usage and cannot bypass an
exhausted budget. On completing a budgeted goal, report its recorded usage.

## Running jobs, attention, and resume

Use `/ps` in TUI to see jobs running in this session. It shows limited recent output
and direct stop action. It does not call quiet process hung. Need exact programmatic
check? Use `jobs.list()` and cursor-based `jobs.inspect()`.

The job-attention defaults are:

- a quiet checkpoint after **5 minutes** without observed activity;
- a review checkpoint every **10 minutes** while a job remains running;
- `jobs.snooze(id, { minutes })` for a positive delay of at most **55 minutes**;
- `jobs.setWatch(id, { enabled: false })` to disable attention for an expected persistent
  service, and `jobs.setWatch(id, { enabled: true })` to re-enable it with a fresh grace
  period.

Attention messages have limited observations and recent output. Jobs keep running
until done or stopped. These intervals are current built-in defaults. They do not show
provider liveness.

`/resume` restores saved conversation and goal entries. It does not revive shell or
sub-agent processes from older die process. Child sessions keep saved role/depth limits.
TUI picker labels them.

## Mode and cache indicators

`/mode fast|normal|orchestrator` changes main agent session instruction frame. It
does **not** switch chosen model, change thinking level, or give child new delegation
powers. Fast and normal both add no extra guidance. Orchestrator adds coordination
guidance. Mode choice stays saved on active session branch.

Footer `cache est` countdown and `/cache-ttl` are only information. Default TTL
estimate is one hour. Accepted values run from one minute to seven days. They live in
`~/.die/cache-settings.json`. Recorded provider request and positive countdown do not
prove cache creation, compatibility, retention, hit, or lower bill.

## Validation scope

Deterministic store, SDK, and TUI fixtures check lifecycle and persistence contracts.
They make no model-quality claim. Real-model goal smoke fixture needs
`DIE_RUN_LLM_TESTS=1`. It makes paid requests only when directly enabled. It records
limited run artifact. Pass means one configured model completed one harmless temporary-
file case. It does not show any goal will finish right.

## Historical transport capture

The original offline SDK 0.87.1 provider capture is in
[goal-transport-marker-audit.txt](goal-transport-marker-audit.txt). It records
the old marker leak, the clean dispatch after the fix and literal-lookalike
preservation. Moved from the root evidence/ folder on 2026-10-04 without
changing its bytes. It is historical proof, not a current provider run.
