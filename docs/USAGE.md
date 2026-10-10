# Using bruv

[Install bruv](../README.md#get-started) · [Migration from bruv 0.x](../README.md#coming-from-bruv-0x)

## Use with T3 Code

Enable the Pi provider and set its binary to `pi`. No launch arguments are needed.
Disable the old "bruv (not Claude)" provider.

## Commands

- `/goal <objective>` starts work; `/goal` shows status, and `pause`, `resume`, or `clear` controls the saved goal.
- `/race <task>` starts three agents from your current changes, each in its own worktree. Use `--n 2` through `--n 5` to change the count. `/race` shows results; pick in the dialog or with `/race pick a2`. `/race pick none` discards the race.
- `/import-codex` previews and imports Codex settings after you confirm.
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

## Bring your Codex setup

Run `/import-codex`. bruv reads `CODEX_HOME/config.toml`, or `~/.codex/config.toml` when `CODEX_HOME` is unset.
It shows a preview before changing anything:

- Set Pi's default model to `openai-codex/<model>` if Pi knows it, and copy minimal, low, medium, high or xhigh thinking. Unknown models and levels are skipped and listed.
- Turn on confirmed fast mode for Codex's `fast` or `priority` service tier. This uses more quota.
- Add MCP servers to Pi's `mcp.json`, keeping existing names. Commands, arguments, environment, URLs and headers carry over; disabled servers stay disabled.
- Add the Codex skills directory to Pi's skill paths.
- Copy Markdown prompts to Pi's `prompts/`, keeping existing files.
- Save trusted projects with Pi's trust store, keeping other decisions.

Existing settings and bruv profiles stay in place. Pi reloads after import; if the host has no reload action, run `/reload`.
Settings go to `~/.pi/agent`, or `PI_CODING_AGENT_DIR` when set.
bruv never reads or copies Codex's `auth.json`. Use `/login` in Pi so Codex keeps its own sign-in.
A notice offers the import once when Codex settings are found.

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
Finished rows show the result and worktree change totals (`+85 −3 · 4 files`), and stay until your next prompt.
Totals are counted once against the starting commit, including committed and uncommitted edits and new files.
Titles shorten to leave room for totals and elapsed time.
Race titles include the race ID, entry number, and the start of the task.
The collapsed race report compares each agent's result, added/deleted lines, check report, and time; expand for the full report.
The footer shows usage, fast mode, goal, then agent cost, separated by ` · `. Only active parts appear.
Script results list the tool calls and show plain output. Bash call rows show the first command line, cut to 60 columns.
Expand a result to see the full script and output.
A dim line after each run with tools totals scripts, calls, agents, elapsed time, and any increase in weekly plan use.
While working, the terminal title spins; waiting shows which agents or jobs are pending.
In supported terminals, a desktop notification and bell announce runs longer than 30 seconds,
races ready to pick, and goals that finish or stop. Terminal effects stay off in T3/RPC, JSON, and print modes.

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
After a successful pick, the terminal starts a turn to run your project checks and fix failures.
In T3/RPC, that request arrives with your next message.
Successful picks and "Keep none" remove all race worktrees and branches. On a conflict,
the worktrees stay available and Git leaves conflict markers for you to resolve.

