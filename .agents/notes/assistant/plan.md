---
name: plan
description: The plan for bruv's web version, a personal assistant (voice + chat) that manages the user's work in T3 Code, made from the discovery and the user's answers on 2026-10-28. Built on 2026-10-29; see web.md for what was built and learned.
---

> The task files and task cards planned here were dropped on 2026-10-29 for a T3-native page that
> lists only the assistant's own threads; see `threads-of-its-own.md`.


# bruv web: plan

The user talks or types (with pasted images) to one assistant, from a computer or a phone. Its job is
to take the load of managing delegated work off the user: they say what they want done, and it runs
that work as T3 Code threads, keeps it moving, and tells them what matters. It doesn't code.

Sources: `t3-access.md` (tried against T3) and the discovery reports this plan was made from.

## What the user decided

- It is **the web version** of bruv, not "voice web". Terminal `/voice` stays as it is.
- Running it all the time is up to the user (systemd, tmux, whatever). bruv gives a command that starts
  it; it keeps no service files.
- **No threads in the user's face.** The user never picks or switches threads. They talk about the work;
  the assistant decides which threads do it, starts them, follows up, and reports per piece of work.
  Modelled on OpenAI Dots (Sept 2026): an always-on agent that keeps making progress between
  conversations, runs scheduled checks, keeps its own notes, delegates to Codex, and has an Activity
  View of what it is doing.
- **Proactive.** It wakes up on its own, looks at what happened, and decides whether to tell the user,
  move work on, or just update its notes.
- **The folder it starts in is its workspace** for its own files (see below). It manages work across all of the user's T3 projects, not one.

## Shape

The web version is a Pi session started with bruv's flag in the workspace folder: `pi --web` (in a
terminal, the same conversation shows there too), or `pi --mode rpc --web` with stdin kept open when
run headless; `pi -c --web` continues. That Pi session is the assistant. Chosen over a separate SDK
host because Pi already runs bruv's TypeScript and loads codemode, MCP and session saving; a
standalone Node process would need its own TypeScript loader. In web mode bruv sets the assistant's
tools and prompt instead of its coding ones.

- **Model:** a fast one at low thinking that takes images, set for this session only.
- **Wake-ups** go in as user messages marked as wake-ups: a custom message that starts a run skips
  `before_agent_start`, so it would lose bruv's prompt sections.
- **T3 for acting: MCP**, through `pi.registerMcpServer` with the key from bruv's own `t3 pair`
  exchange as a header (T3 keys last 30 days, no refresh).
- **T3 for watching: the app's websocket** (`orchestration.subscribeShell`), outside the model: it
  feeds the page and wakes the assistant. Approvals go this way too. Private API, so one small module.
- **The voice engine and page server**, moved from `src/voice/`.

## The workspace folder

Plain files the user can read and fix, unlike Dots, whose memory can't be seen or edited:

- `tasks/<slug>.md`: one per piece of work the user asked for: what was asked, the threads doing it,
  where it stands, what is next, what it is waiting on.
- `memory.md` (or a few files): what it learned about the user and how they like things done.
- The Pi session file, and its log of what it did.

## Waking up

- **On T3 events**, from the websocket: a thread finished, needs the user, or failed. Routine changes
  are only noted.
- **On a timer**, as a fallback and to look across everything (stuck threads, work that went quiet).
  The user sets how often; one hour to start.
- On a wake-up it reads what changed, updates the task files, moves work on, and
  only tells the user when something needs them or is worth knowing. Most wake-ups say nothing.
- When it does tell them: spoken if a page is open with voice on, after nobody is talking; otherwise
  a message in the conversation and a push notification.

## Permissions

No rules file or permission levels. The model asks when it judges it should, from its instructions:
it acts on what the user asked for and asks before anything new, risky, or hard to undo. If that
proves wrong in use, tighten the instructions first.

## The page

- One conversation: voice, typing, images. Work shows as task cards (not thread cards) that update
  live: what it is, where it stands, what it waits on, with buttons for the next step.
- An activity view: what the assistant is doing and has done, per task, with the threads underneath for
  when the user wants to look (link opens the thread in T3). Counts on top: needs you, in progress,
  done.
- React 19, Vite, Tailwind 4, shadcn/ui, lucide-react; built files committed (`pi install` skips dev
  dependencies, `pi update` deletes untracked files); Vite in middleware mode for the dev loop.
- Images pasted, dropped or from the camera, shrunk on the device, sent over the socket.
- Push only on the named tunnel.

## Order

1. The process in its workspace: SDK session, T3 sign-in, the websocket feed, task files, and a page
   that shows the conversation and activity.
2. Chat with images, the assistant's T3 tools, task cards.
3. Waking up: events and the timer.
4. Voice moved into the new page.
5. Approvals, then push.
