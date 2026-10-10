# bruv

bruv is a Pi package that lets the model work through one scripting tool and do several things per turn.
Long work runs in the background, and agents can work in their own git worktrees.
Goals keep the model working until the task is done.

## Install

Install [Pi](https://pi.dev), then:

```sh
pi install git:github.com/tnfssc/bruv
pi
```

Run `/bruv-setup` once, confirm, then run `/reload`.

## Use with T3 Code

Enable the Pi provider and set its binary to `pi`. No launch arguments are needed.
Disable the old "bruv (not Claude)" provider.

## Commands

- `/goal <objective>` starts work; `/goal` shows status, and `pause`, `resume`, or `clear` controls the saved goal.
- `/race <task>` starts three agents from your current changes, each in its own worktree. Use `--n 2` through `--n 5` to change the count. `/race` shows results; pick in the dialog or with `/race pick a2`. `/race pick none` discards the race.
- `/usage` shows ChatGPT plan limits, credits, and session tokens and cost.
- `/fast` toggles the faster priority tier for OpenAI and Codex models; `/fast on` and `/fast off` also work. It uses more quota, including for agents. The default is saved across sessions; the cost confirmation is asked once.
- `/bruv-setup` turns on scripting for all tool calls; run `/reload` afterward.

Goal examples:

```text
/goal Fix the failing tests
/goal Add CSV export --criteria "handles empty data; tests pass" --budget 2m
/goal Review the parser --budget 50k
/goal pause
/goal resume
/goal clear
```

Budgets count tokens; `k` means thousand and `m` means million. The model must record evidence to finish a goal.
A goal also stops at its budget, after the same blocker in three consecutive rounds, or when you stop the run.

## What the model can call from scripts

The model calls these through `tools.<name>(...)` in Pi's scripting tool.

| Tool | What it does |
|---|---|
| `job_start` | Run a shell command in the background and return its ID and recent output. |
| `wait` | Wait for one or all jobs or agents, or until you send a message. |
| `jobs` | List the jobs and agents started in this session. |
| `job_stop` | Stop a job or agent and its child processes. |
| `race` | Start competing agents from your current changes; return a race ID and agent IDs to use with `wait`. You choose the result. |
| `agent` | Start one or several agents, with optional git worktrees. |
| `goal_update` | Record progress, a blocker, or completion with evidence. |
| `ask` | Ask you a question while work continues; your answer arrives as a message. |

## How background work behaves

- Agents return an ID at once. Use `waitSeconds: 0` for jobs to return at once; jobs otherwise wait up to three seconds.
- `wait` blocks until a result, timeout, or new message.
- Esc in the terminal or Stop in T3 ends the run and stops every job and agent it left running. The model hears about it with your next message.
- At the end of a turn, the model gets unseen results or one reminder to wait. Detached jobs do not cause reminders.
- Work left running at the end of a turn reports with your next message. Closing Pi stops all jobs and agents.

## What you see

The terminal board shows each job and agent, its elapsed time, and live agent tools and tokens.
Finished rows show the result and worktree change totals, and stay until your next prompt.
Script results list the tool calls and show plain output. Expand a result to see the full script and output.
A dim line after each run with tools totals scripts, calls, agents, elapsed time, and any increase in weekly plan use.

## Configuration

Set agent profiles in `~/.pi/agent/bruv.json`:

```json
{
  "profiles": {
    "fast": { "model": "openai-codex/gpt-6-luna", "thinking": "low" },
    "normal": { "model": "openai-codex/gpt-6-astra", "thinking": "high" }
  }
}
```

Missing fields use the parent model and thinking level. The model can override either for a single agent.
Ordinary agent worktrees and branches stay on disk after the agent finishes.
A race includes your uncommitted and untracked files. Picking a result applies only that agent's changes to your current worktree, without committing or changing your staging choices.
Successful picks and "Keep none" remove all race worktrees and branches. On a conflict,
the worktrees stay available and Git leaves conflict markers for you to resolve.

## Coming from bruv 0.x

- Sign in again with `/login` in Pi, or copy `~/.bruv/agent/auth.json` to `~/.pi/agent/auth.json`.
- Old sessions under `~/.bruv/agent/sessions` are not migrated.
- Move `~/.bruv/subagents.json` profiles to `~/.pi/agent/bruv.json` using the format above.
- In T3, enable the Pi provider with binary `pi` and disable the "bruv (not Claude)" provider.
- Remove `~/.local/bin/bruv` and `~/.local/bin/bruv-claude-compat`.

## Development

```sh
bun install
bunx biome ci . && bunx tsc --noEmit && bun test
pi install /path/to/checkout
```

Local installs load directly from the checkout. Read `docs/REWRITE.md` before changing a module.
