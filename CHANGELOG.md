# Changelog

## Unreleased

- Make voice bruv's headline: the README, the site and a new demo video lead with it, and the site's first demo is a voice conversation. `/voice tunnel` shows a QR code for the phone, in the terminal and on the page. The voice page installs as an app on a phone or computer.
- Add `/voice`: talk to bruv with this machine's microphone and speaker; `/voice` again turns it off, and `/voice web` adds a browser page to talk from. Speech is recognised and spoken locally by open models (Silero VAD, NVIDIA Nemotron streaming, Kokoro) on the CPU; the session's model answers in short spoken sentences. Talking over a reply stops it at once. The talk button works both ways: hold it to talk, or tap it for hands-free. The page has a mute button that picks up again from the start of the sentence. `/voice tunnel` serves it on your own domain through a Cloudflare tunnel, set up from an API token and a host name. The talk button works the moment it is touched, and the agent can show pages, pictures and videos on the page with a `show` tool.

- Keep the Codex prompt cache when the thinking level changes on GPT-6 models. Requests keep the effort the conversation started with and mark each change where it happened, so earlier turns stay cached. The effort starts again after a compaction or a model switch.

- Keep Codex compaction across Codex model switches, and save a readable summary next to it. If Codex compaction fails, that summary is used instead, so history is no longer lost on a failure or a provider switch. Compaction keeps fast mode and accepts extra items in the reply.

- Price fast-mode replies at the priority rate when Codex reports the default tier, so the footer and `/usage` no longer show half the cost.

- Tell the model the current time when a session starts and again after an hour, and send bruv's own messages (reports, goal and keep-going nudges) to OpenAI models as developer messages instead of user messages.

- Show job output the way a terminal does, so progress bars keep only their last state, and mark output that was cut short. Background jobs no longer take git's optional index lock.

- Show how much of the last prompt was read from the cache next to the countdown, take the cache lifetime from the model (about 5 minutes for Luna), and stop Pi's cache warming on Codex, where a warm-up would be a full reply.

- `/usage` shows banked plan resets.

- Add `apply_patch` in Codex's patch format, written in TypeScript. OpenAI models call it directly, as in Codex: Codex's grammar lets them write the raw patch instead of JSON. Scripts can call it on any model. It checks every change before writing, so a patch that fails changes nothing.

- Replace Pi's opening line, tool list, general rules and docs list with bruv's guidance. The tools' own rules stay, and a short file maps Pi's docs for questions about Pi. The prompt now names the session's own file, so the model can look up messages from before a compaction.

- Bring back the compact transcript from 0.x: no blank row between replies, tool lines and reports, one plain row around user messages, tight thinking, no "Thinking..." rows when thinking is hidden, no Ctrl+O status line, and a one-row input. It changes how Pi draws while bruv runs, never Pi's files, and keeps Pi's spacing on a Pi that lacks the parts it changes. `/bruv-compact off` turns it off live.

- Bring the website back to its terminal style: the page and its demos are drawn as terminal cells, with an HTML view for everyone else. New demos show bruv 1.0 keeping a run going, a fresh agent finding gaps before the receipt, and work running in the background. The site serves `install.sh` again.

- Show a large bruv logo in the middle of an empty chat, with a light band that sweeps across it every few seconds. It goes away with the first message and hides on small terminals.

- Leave the skill list out of the main agent's prompt, as in 0.x. Skills still load, `/skill:name` still works, and the model can look them up.

- Tell the main agent to hand off separate pieces in worktrees and work elsewhere or wait. Update the script example to request worktrees.

- Keep the board short: show running work, the latest three finishes and finishes from the last 30 seconds. Fold older results into counts and hide the board after work goes quiet.

- Include plain-text receipts and gap lists in finish tool results for T3/RPC and model context.

- Render finish gaps as a red count and wrapped list. Show the receipt in the accepted finish result once, and show notes for waiting and blocked results.

- Complete goals through a passing fresh check and save its checked items as evidence. Keep gaps as next steps, remove completion from `goal_update`, and preserve budget, blocker and abort stops.

- Show a framed terminal receipt after checked finishes: the request, what was tried, remaining gaps, file totals, time and usage.

- Check changed work with a fresh agent before accepting `finish(done)`. Retry gaps twice, stop checks on abort, and add `/check on|off`.

- Keep GPT runs going until they call `finish` with their reply. Add `/keep-going on|off|auto`, saved for sessions and child agents. Keep finish visible in codemode-only mode, respect Esc and Stop, and stop after two continuations without tools.

- Removed `/race`.

- Add `/review` for uncommitted changes, branch diffs and commits, with bug-focused guidance and no file edits unless asked.

- Add `/import-codex` with a preview for models, thinking, fast mode, MCP servers, skills, prompts and trusted projects. Keep existing settings and leave sign-in tokens alone.

- Show each pending script call once and update its row when it finishes.


- Separate footer parts with dots in a fixed order: usage, fast, goal, then agent cost.
- Fix worktree diff totals when `.tmp/` is ignored; count once at completion and keep totals visible beside long titles.
- Shorten bash call rows to the first command line and 60 columns.
- Clear inherited agent settings before tests so the suite also runs inside bruv agents.

- Notify when long runs and goals finish; show a working title and pending wait IDs in the terminal. Keep terminal escapes out of RPC, JSON, and print modes.

- Add a dim turn summary with tool and agent counts, elapsed time, and weekly plan use changes.

- Render script calls and bash/wait output as readable lines, with full script and output on expansion.

- Show running jobs and agents on a live board with tools, tokens, elapsed time, and finished worktree changes.

- Save `/fast` globally for future sessions and agents, with a one-time cost confirmation.
- Add `/usage` for ChatGPT plan limits, credits, and session usage, with footer status and limit warnings.

## 1.0.0

- Rewrite bruv as a Pi package installed with `pi install`.
- Remove voice, remote access, the web UI, the T3 Claude connector, history search, the old compaction modes, the compiled binary, and the updater.
- Start jobs and agents in the background, wait inside tools, and deliver work left running with the next message. Esc or Stop ends the run and its background work.
- Carry over goals, fast mode, Codex compaction, and questions that let work continue while the user answers.
