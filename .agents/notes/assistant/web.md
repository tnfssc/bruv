---
name: web
description: How the web version (pi --web) is built after step 1, the performance rules it follows, and the gotchas met while running it for real on 2026-10-29.
---

# The web version, as built

`pi --web` in a folder makes that Pi session the user's assistant; the page is at
`http://127.0.0.1:7808/?t=<key>` (key in `~/.pi/agent/bruv/web/key`). `--web-dev` serves the page from
`web/` through Vite with hot reload.

- `extensions/bruv.ts` loads a lean set for `--web` (UI basics, codemode, reasoning, compaction, web), read
  from `process.argv` because Pi sets flag values only after extensions load. Jobs, agents, goals, checks,
  `finish`, reviews, notes, apply_patch and voice stay out: they serve coding and act on every run (`check`
  would snapshot the workspace and review the assistant's note edits; `finish` nags Codex-style models).
- The assistant gets only `codemode`, `tool_search`, `read`, `write`, `edit`, `overview` and `mcp__t3__*`,
  and bruv's coding prompt is replaced by `prompts/assistant.md` (as `customPrompt`).
- `overview` answers "what's going on" across every project from the live feed bruv already holds: no
  T3 call, a few hundred bytes. Before it, the model guessed one project (outside clients must pass
  `projectId` to `t3_thread_list`) or looped over all projects in five calls; with it, one call.
- Modules: `src/web/index.ts` (web mode), `server.ts` (page, pictures, socket), `lines.ts` (Pi messages to
  page lines), `overview.ts`, `protocol.ts` (the socket contract), `t3/` (sign-in and live feed),
  `assets.ts` (built page or Vite). The page is `web/` (React, Vite, Tailwind, shadcn); `web/dist` is
  committed and a test fails when it is stale. That test builds under Node with `NODE_ENV=production`:
  Bun's runtime and the `NODE_ENV=test` that `bun test` sets both change the output.

## Performance rules

The user made this a hard requirement: a chat of hundreds of thousands of messages must feel like one of
five, with as little network, memory and disk as possible, on the server and in the browser.

- A page gets the latest 50 lines on connect and asks for 50 older ones at a time (`more`/`older`). The
  server walks back from the session's leaf through `getEntry`/`parentId`, so the cost is the lines asked
  for, not the session's length (tested with 20,000 messages).
- A reply being written goes as `append` deltas from Pi's `text_delta`, at most every 100 ms, so a long
  reply costs its length once. The finished line is sent whole once.
- Pictures are links (`/image/<line>/<n>?t=`), cached for good by the browser. Live ones are served from a
  small in-memory map until Pi saves the message (it saves after extensions hear `message_end`); saved
  ones are read from the session entry.
- The page virtualizes the conversation and the thread list, keeps at most ~2000 lines in memory, and
  parses Markdown only for rows on screen.
- The T3 feed resumes from its last sequence after a reconnect (about 5 KB instead of the 1.8 MB
  snapshot), keeps only mapped threads, and sends a change only when a mapped field changed.
- Only top-level threads go to the page; about two thirds of T3's threads are providers' subagents.

- Pi reads a session's whole file at start and keeps its entries in memory, which bruv can't change. So
  when the file passes `web.sessionMB` (default 20) after a run, the assistant moves to a fresh session
  (`/web-fresh`, sent with `expandPromptTemplates` so it runs as a command, not a message) whose header
  names the old file as its parent and whose first entry tells the model where its notes are. Pi
  re-creates extensions on a session switch: the old instance closes the server on `session_shutdown` and
  the new one starts it on `session_start`, and pages reconnect. The SDK used in tests leaves `newSession` a
  no-op, so this is checked by hand, not in `bun test`.
- The page scrolls back past a fresh session into its parents: `src/web/archive.ts` reads those files
  backwards from a byte offset in 64 KB chunks (line ids `a<n>.<offset>`), so it costs the lines shown and
  holds nothing in memory.
- Disk reads at run time: the config and the assistant's thread list once at start, one `stat` of the
  session file per run; the thread list is written only when the assistant starts a thread.

## The assistant's threads and wake-ups

- T3-native since 2026-10-29: the page lists only the T3 threads the assistant started, with their
  subagents, forks and delegated tasks under them. There are no task files; the user found a second list
  of "tasks" beside T3's threads confusing, and asked for T3's threads alone. See `threads-of-its-own.md`.
- `src/web/wake.ts` follows the assistant's threads. One that starts needing the user, fails, or finishes
  after working is news; events within 3 s go as one wake-up. A wake-up waits while the assistant is busy
  or a part says the user is talking, retrying every 5 s and at once when a run settles. While any of them
  is at work it also takes a regular look every `web.lookMinutes` (default 60), skipped when news already
  woke it.
- A wake-up is a user message starting `[wake-up] ` (custom messages that start a run lose bruv's prompt);
  the page shows it as a small check-in, not as the user. If the run it starts ends with written words,
  they are news: parts get `news(text)` (push sends it when no page is in front, reported by the page's
  `visible` events).

## Parts

Voice, push and the tunnel plug in as `WebPart`s (`src/web/part.ts`, listed in `src/web/parts.ts`): each
gets the HTTP server, the key, `say`, `stop`, `watched`, `address`/`setAddress`, and follows `reply`,
`busy`, `news`; `talking()` holds wake-ups. T3's MCP key is checked every 6 hours and registered again
when a new sign-in replaced it.

## Gotchas from running it for real

- The global `pi` (1.4.0) is not the repo's (1.1.0).
- `pi -ne` still loads installed packages, so the user's installed bruv loaded beside the checkout's; test in
  a scratch agent dir (`PI_CODING_AGENT_DIR`) with `settings.json` minus `packages` and the user's
  `auth.json` linked. Only `opencode-go` is signed in there; `opencode-go/gpt-6-luna` at low thinking takes
  images and worked well. `kimi-k3` leaked tool-call markup into its text.
- A Pi left running kept port 7808, and the next run quietly moved to another port and another key: check
  which process answers before reading results.
- `pgrep -f`/`pkill -f` match the calling shell's own command line; stop runs by a saved pid.
- Closing a headless run's stdin shuts it down within a second.
- T3's MCP key is registered once at start; a key refused later (after 30 days) isn't re-registered yet.

## What using it for real taught (2026-10-29)

Driven through Chrome against the real T3 with `opencode-go/gpt-6-luna` at low thinking: two scratch
jobs, a vague ask, a risky ask, a pasted screenshot, phone size, real speech through a fake mic
(`espeak-ng` into `--use-file-for-fake-audio-capture`), and a thread that needed approval.

- Silence reads as broken: 25-45 s of a bare dot. Now the page shows a step line from each tool call: a
  codemode script's opening comment (the prompt asks for one), or words for the first tool it calls.
- The model fumbled T3 launches: `scratch: true` takes no `projectId`, and an outside caller must pass
  `modelSelection` (no default). Both are in the prompt now, with the tool names, so it stops searching.
- It sat in `t3_thread_wait`; the prompt now says to end the turn, since wake-ups bring the news.
- It skipped the task file for quick work, so nothing was followed. (Task files are gone: bruv now notes
  every thread the assistant starts itself.)
- "What's going on?" cost a model round trip for `overview`. The overview now rides along with the user's
  message (a hidden `nextTurn` custom message) only when it changed, and the answer came in ~4 s.
- Bug: the waker took a thread's first event as its baseline, so a thread whose first event was "waits on
  the user" never woke the assistant. It now starts following from T3's current state (`lookup`).
- Approvals work end to end: T3 answers a permission request through the app API's
  `runtime-request.respond` (`src/web/t3/feed.ts` `dispatch`, a one-off socket), used by the `approve` tool
  and the page's Approve/Deny buttons. A thread's *question* (`user_input`) goes through MCP's
  `t3_pending_request_respond` instead. A read-only command (`python3 --version`) ran without asking even in
  `approval-required`; the assistant said so instead of claiming success.
- Behaviour that felt right: a vague ask got "Which bug do you mean?", "merge all my PRs" got a
  confirmation, a pasted error screenshot was read correctly, nothing was read out as ids.
- Voice: espeak's speech was recognised word for word; about 8 s of "Thinking" before speech on that
  question (model plus a tool call; the overview hint now saves the call).

## Client state: why not TanStack DB (tried 2026-10-29)

The user wanted the page to feel instant with no odd behaviour and asked whether a sync engine like TanStack
DB fits. It was built and worked (collections fed by the socket, optimistic send and approve), but:

- The main chunk went from 91 KB to 177 KB gzip; about 55 KB of it is live queries, about 40 KB the
  collections alone.
- While an optimistic change to a collection waits on the server, TanStack DB holds back every synced write
  to that collection. Sending mid-reply froze the streaming reply, and a pending approve froze the thread
  panel, until the pending changes were moved into separate side collections.

So the page keeps its own small store, with the optimistic parts written by hand: a sent line shows at
once under a page id that the server echoes back (`say.id`), and Approve/Deny apply at once over the
thread, each rolled back if the server doesn't confirm. TanStack AI was also looked at and left out: its
`useChat` assumes the page starts each run, and here the server owns one shared conversation (several
pages, wake-ups, voice).
