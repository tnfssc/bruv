import type { Line, ServerEvent, Thread } from "../../../src/web/protocol";
import { heard, settleAnswers, settleSends } from "./optimistic";
import { send } from "./socket";
import { getState, lines, setState, threads, touch, touchAll, trimmed } from "./store";

/** Turns the server's events into the store. */

function setThreads(list: Thread[], replace: boolean) {
  if (replace) threads.clear();
  for (const thread of list) threads.set(thread.id, thread);
}

/** A `hello` replaces everything, so a reconnect starts clean; lines still on their way stay on their way. */
function hello(event: Extract<ServerEvent, { type: "hello" }>) {
  const waiting = getState().sending.flatMap((id) => {
    const line = lines.get(id);
    return line ? [line] : [];
  });
  lines.clear();
  for (const line of event.lines) lines.set(line.id, line);
  const sending: string[] = [];
  for (const line of waiting)
    if (!lines.has(line.id)) {
      lines.set(line.id, line);
      sending.push(line.id);
    }
  setThreads(event.threads, true);
  settleAnswers(event.threads, true);
  setState({
    ready: true,
    ids: event.lines.map((line) => line.id),
    sending,
    more: event.more,
    fetching: false,
    busy: event.busy,
    t3: event.t3,
    projects: event.projects,
    threadsVersion: getState().threadsVersion + 1,
    tasks: event.tasks,
  });
  touchAll();
  for (const line of event.lines) heard(line.id);
  settleSends(event.busy);
}

/** A new line, or a newer version of one here. A line the page sent moves from `sending` to the end of `ids`. */
function line(next: Line) {
  const { ids, sending } = getState();
  const waiting = sending.includes(next.id);
  const known = lines.has(next.id) && !waiting;
  lines.set(next.id, next);
  if (known) touch(next.id);
  else {
    setState({
      ...trimmed([...ids, next.id]),
      ...(waiting ? { sending: sending.filter((id) => id !== next.id) } : {}),
    });
    if (waiting) touch(next.id);
  }
  heard(next.id);
}

export function apply(event: ServerEvent) {
  switch (event.type) {
    case "hello":
      return hello(event);
    case "line":
      return line(event.line);
    case "append": {
      const old = lines.get(event.id);
      if (!old) return;
      lines.set(event.id, { ...old, text: old.text + event.text, partial: true });
      touch(event.id);
      return;
    }
    case "older": {
      const fresh = event.lines.filter((line) => !lines.has(line.id));
      for (const line of fresh) lines.set(line.id, line);
      setState({ ids: [...fresh.map((line) => line.id), ...getState().ids], more: event.more, fetching: false });
      return;
    }
    case "busy":
      setState(event.busy ? { busy: true } : { busy: false, step: "" });
      return;
    case "step":
      setState({ step: event.text });
      return;
    case "t3":
      setState({ t3: event.t3 });
      return;
    case "projects":
      setState({ projects: event.projects });
      return;
    case "threads":
      setThreads(event.threads, false);
      settleAnswers(event.threads, false);
      setState({ threadsVersion: getState().threadsVersion + 1 });
      return;
    case "tasks":
      setState({ tasks: event.tasks });
      return;
  }
}

/** Asks for the lines before the oldest one here, once at a time. */
export function askOlder() {
  const { more, fetching, ids } = getState();
  const before = ids[0];
  if (!more || fetching || !before) return;
  if (send({ type: "more", before })) setState({ fetching: true });
}

if (import.meta.hot) import.meta.hot.accept(() => location.reload());
