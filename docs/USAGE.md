# Using bruv

[Install bruv](../README.md#get-started) · [Migration from bruv 0.x](../README.md#coming-from-bruv-0x)

## Use with T3 Code

Enable the Pi provider and set its binary to `pi`. No launch arguments are needed.
Disable the old "bruv (not Claude)" provider.

## Commands

- `/keep-going` shows the setting. `/keep-going on|off|auto` saves it for this session, future sessions and child agents. `auto` is the default: on for OpenAI and Codex Responses APIs, off for other APIs.

- `/check on|off` saves whether a fresh agent checks finished work (on by default). `/check` shows it.

- `/goal <objective>` starts work; `/goal` shows status, and `pause`, `resume`, or `clear` controls the saved goal.
- `/review` picks uncommitted changes, a branch diff, or a commit; `/review <branch or commit>` starts directly.
- `/import-codex` previews and imports Codex settings after you confirm.
- `/usage` shows ChatGPT plan limits, credits, banked plan resets, and session tokens and cost.
- `/fast` toggles the faster priority tier for OpenAI and Codex models; `/fast on` and `/fast off` also work. It uses more quota, including for agents. The default is saved across sessions; the cost confirmation is asked once.
- `/voice` lets you talk to bruv. It opens a page in your browser: press start, allow the microphone and talk. Replies are read aloud, and talking over one stops it. `/voice here` uses this machine's microphone and speaker instead (use headphones: nothing cancels the echo), `/voice tunnel` puts the page on your own domain through Cloudflare, and `/voice off` stops. `pi --voice` starts with voice on. See [Voice](#voice).
- `/notes` lists the project's notes in `.agents/notes/`. `/notes move` moves a bruv 0.x `wisdom/` folder there, keeping git history.
- `/ps` lists this session's jobs and agents. Pick one to read its output or answer, see its worktree and session file, or stop it.
- `/subagents` picks which of your signed-in models agents may use. The model chooses among them per task; your own model is always allowed and is the default.
- `/bruv-migrate` brings your sign-in, settings, agent models and sessions over from bruv 0.x after showing what it will copy. It never changes `~/.bruv`.
- `/bruv-setup` turns on scripting for all tool calls and a quiet start; run `/reload` afterward.
- `/bruv-compact` turns the compact transcript on or off; `/bruv-compact on` and `/bruv-compact off` also work. It is on by default and switches right away. On Pi versions bruv doesn't know yet, Pi's own spacing is used.

Goal examples:

```text
/goal Fix the failing tests
/goal Add CSV export --criteria "handles empty data; tests pass" --budget 2m
/goal Review the parser --budget 50k
/goal pause
/goal resume
/goal clear
```

Budgets count tokens; `k` means thousand and `m` means million. The model calls `finish(done)`
to complete a goal. A fresh agent checks the objective and criteria even when no files changed;
only a pass completes the goal, saving its checked items as evidence. Gaps stay on the goal as
next steps. `goal_update` records progress and blockers; it cannot complete the goal.
If checks are off, fail, or reach the two-round limit with gaps, finish can end the run while the
goal stays active.
A goal also stops at its budget, after the same blocker in three consecutive rounds, or when you stop the run.

## Finish the work

With keep-going active, a text reply alone does not end the run. The model writes its reply and calls
`finish` in the same message: `done` when everything asked is done and checked, `need_you` when
the next step is your choice, or `blocked` when it cannot go on. An optional `note` adds detail.
Call `finish` alone after other tool calls have returned; Pi skips the next model request only
when every tool in a batch agrees to end the run.

Before accepting `done`, bruv checks work that changed files since your latest message, including
committed edits and new files. A fresh agent gets your messages, the final reply and the diff,
then tries the result. It uses your model and thinking level, so checks use extra quota.
A new message during a check stops that check and updates the request.
Gaps send the model back to work. After two checks, the next finish is accepted with any remaining
gaps recorded. A failed checker does not hold up the run. Plain answers without file changes skip
this check. `/check off` disables it.

`finish` stays a top-level tool even in codemode-only mode. An active goal also enables it, even when keep-going is off.
Job reports and reminders come first, then goal continuation, then keep-going. Each settle adds
at most one continuation. An explicit finish also stops job and goal continuations; a goal without a passing check
stays available and unseen results arrive with your next message. Two keep-going continuations with no tool calls stop the loop. Any
tool call or new user message resets that count. Esc or T3 Stop ends the run and its jobs at once.

## Review changes

Run `/review` to choose uncommitted changes, a local branch, or one of the last 20 commits.
The branch picker puts the remote's default branch first when it exists locally, then falls back to main or master.
Use `/review develop` or `/review HEAD~1` to skip the picker.

Uncommitted reviews cover staged, unstaged and untracked files. Branch reviews compare your current work
with the merge base of the chosen branch. Commit reviews cover just that commit's changes.
The review starts one turn, including in T3/RPC. It asks for real bugs with file:line, impact and a fix,
then at most a few useful simplifications. It skips style nits and leaves files alone unless you ask for changes.

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

`finish` is called directly when keep-going or a goal is active. The model calls the following through `tools.<name>(...)` in Pi's scripting tool.

| Tool | What it does |
|---|---|
| `apply_patch` | Add, change, delete or move files with one patch in the Codex format. A patch that doesn't fit the files changes nothing. |
| `job_start` | Run a shell command in the background and return its ID and recent output. |
| `wait` | Wait for one or all jobs or agents, or until you send a message. |
| `jobs` | List the jobs and agents started in this session. |
| `job_stop` | Stop a job or agent and its child processes. |
| `agent` | Start one or several agents, with optional git worktrees. |
| `goal_update` | Record goal progress or a blocker. |
| `ask` | Ask you something only you can decide, with its pick, while work continues. In the terminal the question waits above the input and your next message answers it (a number picks a choice). |

## How background work behaves

- Give agents big, separate pieces of work, each in its own worktree when editing files. Work on something else or wait once you hand a piece to an agent.
- Agents return an ID at once. Use `waitSeconds: 0` for jobs to return at once; jobs otherwise wait up to three seconds.
- `wait` blocks until a result, timeout, or new message.
- Esc in the terminal or Stop in T3 ends the run and stops every job and agent it left running. The model hears about it with your next message.
- At the end of a turn, the model gets unseen results or one reminder to wait. Detached jobs do not cause reminders.
- Work left running at the end of a turn reports with your next message. Closing Pi stops all jobs and agents.

## What you see

Tool calls fold into one dim line per stretch of work, like `7 tools called`. While the run is
active it also says what the newest script is doing. Click the line to open every call in it, or
press Ctrl+O to open all of them. The input has no frame: its prompt mark turns into a spinner while
bruv works, and the footer is one line with the folder, branch, plan use, fast mode, context use
and model.

The terminal board shows every running job and agent, its elapsed time, and live agent tools and tokens.
Finished rows show the result and worktree change totals (`+85 −3 · 4 files`). Only the three most
recent finishes or those from the last 30 seconds stay visible; older rows fold into done, failed
and stopped counts. The board hides when nothing is running and no finish is less than 30 seconds
old. Your next prompt also clears finished rows.
Totals are counted once against the starting commit, including committed and uncommitted edits and new files.
Titles shorten to leave room for totals and elapsed time.
The footer shows usage, fast mode and goal, separated by ` · `. Only active parts appear.
The footer's dollar amount is what the session, agents included, would cost at API prices (`api` marks it on a subscription, where it is only a price); it moves after each model response. `cache 96% · 42m` shows how much of the last prompt was read from the provider's prompt cache and counts down the time left on it since your model last answered: yellow under 15 minutes, red under 5. Coming back after it expires costs more. The lifetime comes from the model, or 5 minutes for Luna and 60 for other models; set `cacheTtlMinutes` in `~/.pi/agent/bruv.json` to change it.
Script results list the tool calls and show plain output. Bash call rows show the first command line, cut to 60 columns.
Expand a result to see the full script and output.
When a check finds gaps, the finish result shows a red count and every gap, wrapped to fit,
then “Fixing, then checking again.” Waiting for your choice and blocked finishes show their note.
Expand a finish result to see its raw note too.
An accepted checked finish shows a framed receipt in its tool result with your request, up to five things the fresh agent
actually checked, any remaining gaps, changed files and line totals, elapsed time, calls, agents,
and any increase in weekly plan use. Failed checks say “Check didn't complete.” The receipt
appears once, with no separate after-run entry. T3/RPC receives the same receipt as plain text
in the finish tool result. Gap results also carry the full list as plain text. Both enter model context.
Other runs with tools get a dim summary line with counts, elapsed time and weekly plan use.
While working, the terminal title spins; waiting shows which agents or jobs are pending.
In supported terminals, a desktop notification and bell announce runs longer than 30 seconds,
and goals that finish or stop. Terminal effects stay off in T3/RPC, JSON, and print modes.

## Voice

Speech is recognised and spoken on your machine, on the CPU, by open models: Silero VAD hears when you talk, NVIDIA's streaming Nemotron (English) writes down what you say, and Kyutai's Pocket TTS speaks. The first `/voice` asks before downloading them (about 560 MB, to `~/.pi/agent/bruv/voice/models`). Only the session's own model, the one you already use, runs elsewhere, so voice costs nothing on top of it. Thinking makes the first words slower; `low` suits talking.

Talking over a reply pauses it at once. A cough or the speaker's own echo resumes it; real words stop the reply and the run, and go to the model. Talking while the agent works without speaking steers the work instead of stopping it.

The talk button listens from the moment you touch it. **Hold** it while you talk, and the words go as soon as you let go, without waiting for silence; it suits noisy places. **Tap** it for hands-free: the microphone stays open and a pause ends each turn; tap again to turn it off. Words you start saying during the tap are kept. Pressing during a reply cuts in. On a computer, Space works the same way, and the ⋯ menu lists the keys. On a phone the controls take the bottom half of the screen; the arrow next to them makes them one small row, and the page remembers that.

**Mute** (or M) pauses the voice. Unmuting starts again from the beginning of the sentence it was saying. The sentence being spoken is lit up in the reply. **Stop** (or Esc) drops the rest of the reply.

The button works the moment you touch it: the page connects while it loads, and what you say before the connection is up is sent as soon as it is.

While voice is on, the agent can also put things on the page when seeing beats hearing: a page it writes (a table, a chart, code), or a picture or video from a file or a link. It says in a sentence what it showed. Each one appears in the conversation; the corner button opens it full screen. Pages run in a sandbox, apart from the voice page and its key.

The page needs a key that is in its link and stays the same across runs (`~/.pi/agent/bruv/voice/token`). It listens on `127.0.0.1:7807`. Anyone with the link can talk to your agent, so keep it private.

### From anywhere

Browsers allow the microphone only on `localhost` or https. `/voice tunnel` serves the page on a host name of yours, such as `voice.example.com`, through a Cloudflare tunnel. It asks for the host name and a Cloudflare API token with these permissions: Account › Cloudflare Tunnel › Edit, Zone › DNS › Edit, and Zone › Zone › Read. It then makes a tunnel named `bruv-voice-<host>`, points it at the page, adds a DNS record for the host, and starts `cloudflared`. If `cloudflared` isn't installed, it asks before downloading it. It never replaces a DNS record it didn't make.

The token is kept in `~/.pi/agent/auth.json` as `cloudflare-tunnel`, so `/logout` can remove it, and the host in `bruv.json`. After that, every `/voice` starts the tunnel too and shows both links. `/voice tunnel off` stops using it. A tunnel token from the Cloudflare dashboard also works; then set the tunnel's public host name to `http://localhost:7807` there.

Other tunnels work too, such as `tailscale serve 7807`. Open the tunnel's address with the same `?t=` key.

```json
{ "voice": { "port": 7807, "host": "127.0.0.1", "voice": "bria", "threads": 4, "tunnel": "voice.example.com" } }
```

`voice` is `bria` or `loona`, or the path of a WAV file of someone talking, whose voice Pocket TTS then copies. `threads` is how many CPU threads each model uses.

## Configuration

Set agent profiles in `~/.pi/agent/bruv.json`:

```json
{
  "keepGoing": "auto",
  "checkWork": true,
  "profiles": {
    "fast": { "model": "openai-codex/gpt-6-luna", "thinking": "low" },
    "normal": { "model": "openai-codex/gpt-6-astra", "thinking": "high" }
  }
}
```

Missing fields use the parent model and thinking level. The model can override either for a single agent.
Ordinary agent worktrees and branches stay on disk after the agent finishes.
