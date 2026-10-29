---
name: thread-messages
description: How what a T3 thread says reaches the assistant asynchronously (its last words with "finished", progress gathered every two minutes), and the T3 subscription it rests on. Built and run against the real T3 on 2026-10-29.
---

# What threads say reaches the assistant

The user wanted the assistant (the parent) to get a thread's last message when it finishes, and status
updates while it works, without asking, so it can act on them like a parent agent on its child's result.

- **Where it comes from.** T3's shell feed has no message text (`latestVisibleMessage` is always null).
  `orchestration.subscribeThread {threadId, afterSequence, requestCompletionMarker}` streams a thread's
  events; `message.updated` carries `{id, role, text, streaming, runId, updatedAt}`, the whole text each
  time. bruv passes on assistant messages with `streaming: false`, once per id and text.
- **Cheap.** `src/web/t3/follow.ts` follows only threads named by open tasks, all on one socket (Effect
  RPC carries many requests). Positions are the thread's own, not the shell feed's: T3 answers a position
  past the thread's last event, more than 128 events back, or over 1 MiB of replay with a whole snapshot
  (T3 source, `apps/server/src/ws.ts`, same in the 0.1.2 nightly). So a thread followed for the first time
  starts with a bounded snapshot (`acceptBoundedSnapshot`; 28 KB for a fresh scratch thread, 680 KB for a
  long old one, compressed on the socket) whose messages are the past, and then resumes from its own last
  position: a small run was about 40 KB of events. A snapshot that replaces a resume passes on finished
  messages from after following began, so a thread that finished while bruv was away isn't lost. T3
  normally ends a message with `streaming: false` but has no sweep that guarantees it, so a run's end
  (`run.updated`, terminal status) passes on its last message if it wasn't. MCP's `t3_thread_read` pages
  forward only and has no notifications, and the REST thread endpoints are 100-150 KB, so this socket is
  the only cheap way.
- **T3's source** is at github.com/pingdotgg/t3code (open source); read it rather than the built bundle.
- **Batching** (`src/web/wake.ts`): a message waits up to two minutes for more; a status change (finished,
  failed, waiting on the user) sends it with the event after the usual 3 s. Last three messages per
  thread, each cut at 4000 characters.
- **Delivery:** the page shows the short wake-up line; what the threads said goes to the model as a hidden
  `bruv-web-said` message with the turn. Run for real: a scratch job finished and the assistant answered
  from the message alone, without reading the thread.

## Activity panel actions

- "Ask about this" on an opened task or thread sends a question as the user (and closes the phone's
  sheet so the answer shows).
- "Open in T3" links to T3's page for the thread: `<origin>/<environmentId>/<threadId, URL-encoded>`,
  with the environment from `/.well-known/t3/environment` (no key). Hidden when T3 is on loopback and the
  page isn't, since a phone can't open 127.0.0.1. A browser not signed in to T3 lands on T3's pairing page;
  signed in, the link opens the thread (checked).
