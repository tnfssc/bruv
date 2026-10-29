---
name: threads-of-its-own
description: Why the web version shows only the T3 threads its assistant started, how bruv knows which those are (T3 can't say), and what replaced the task files. Decided and built 2026-10-29.
---

# The assistant's own threads, and no task files

The first version had the assistant keep `tasks/<slug>.md` files and showed them as "Your work" above all
of T3's threads. In use the user saw a list of "weird tasks" next to threads, some with no thread at all
(the assistant made a task for a question it answered itself), and counts that didn't match. They asked
for it to be T3-native: show only the T3 threads this assistant started, nothing else, since its one job
is managing their work in T3.

- **T3 can't tell whose a thread is.** Checked in T3's source: `t3_thread_launch` from an outside MCP
  client records only `createdBy: "agent"`, `creationSource: "mcp"` and an `mcp:<uuid>` id, shared by
  every MCP client, forks and delegated tasks. The caller's identity isn't saved; threads take no labels;
  `t3_thread_list` can't filter by creator; a launch is always top-level.
- **So bruv keeps the list** (`src/web/mine.ts`): every thread id a `t3_thread_launch` returns, caught
  from `tool_execution_end`, which Pi reports for calls inside codemode scripts too. It lives in
  `bruv/web/threads.json` under Pi's folder, keyed by the assistant's workspace folder, so two assistants
  keep their own lists and nothing extra sits in the workspace. Ids are unique across T3 environments, so
  it works with a T3 elsewhere. A launch whose answer was lost isn't caught.
- **What descends from them** comes along: anything whose `parentId` chain (lineage) reaches a listed
  thread, so subagents, forks and delegated tasks show under their parent without being listed.
- **The page** gets only these threads (less on the wire than all ~750 top-level threads before), with
  subagents under their parent; a parent with a subagent waiting on the user moves to "Needs you" and the
  subagent's Approve/Deny shows on the parent's row. Each thread the assistant starts also appears as a
  live card in the conversation, at the point it started it (a `bruv-web-thread` custom entry), with what
  it last said, its request if any, and Ask/Open in T3.
- **The last message** on rows and cards comes from following the thread (`follow.ts`); T3's records never
  carry one.
- **Following** only the assistant's threads that are at work, waiting, or changed in the last ten
  minutes, so old threads cost no subscription snapshot.
- **The assistant** sees its own threads in `overview` and the "T3 right now" hint; `overview all: true`
  shows the rest of T3 when the user asks. It keeps `memory.md` for what it learns about the user; T3
  holds the state of the work, so it titles threads by the work and sends follow-ups to its existing
  thread instead of starting another.
- From the product survey (Claude Projects, Claude agent view, Cursor, Copilot, Warp, T3's own inbox):
  group by state with "needs you" first, show the blocking question on the row with one-tap answers, keep
  "done" apart from "unread", and put live thread cards in the conversation. Done here except showing a
  question's text (T3's shell record has only the request's kind).
