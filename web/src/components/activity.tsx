import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDownIcon, ExternalLinkIcon, MessageCircleQuestionIcon } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { toAsked, toEnd } from "@/lib/events";
import { age } from "@/lib/time";
import { cn } from "@/lib/utils";
import { type Activity, type Group, groupOf } from "@/state/activity";
import { answer, say } from "@/state/optimistic";
import { threads as allThreads } from "@/state/store";
import { useActivity, useNow, useStore } from "@/state/use-store";
import type { T3State, Task, Thread } from "../../../src/web/protocol";
import { Phone } from "./phone";

const dots: Record<Group, string> = {
  needs: "bg-needs",
  working: "bg-working animate-blink",
  done: "bg-done",
  recent: "bg-muted-foreground/40",
};

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </>
  );
}

/** Asks the assistant how a piece of work is going, as if the user had typed it. */
function ask(words: string) {
  say(words, []);
  toEnd();
  toAsked();
}

/**
 * Where T3's own page opens a thread, or nothing when this device can't reach it: T3 on this computer
 * (127.0.0.1) can't be opened from a phone.
 */
function useThreadLink(id: string) {
  const app = useStore((state) => (state.t3.state === "connected" ? state.t3.app : undefined));
  if (!app) return undefined;
  const loopback = (host: string) => host === "localhost" || host === "[::1]" || host.startsWith("127.");
  if (loopback(new URL(app).hostname) && !loopback(location.hostname)) return undefined;
  return `${app}/${encodeURIComponent(id)}`;
}

/** The actions under an opened row: ask the assistant about it, and open the thread in T3. */
function Actions({ question, link }: { question: string; link?: string }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <button
        type="button"
        onClick={() => ask(question)}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-muted px-2.5 text-[13px] transition-colors hover:bg-accent"
      >
        <MessageCircleQuestionIcon className="size-3.5" aria-hidden="true" />
        Ask about this
      </button>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-muted px-2.5 text-[13px] transition-colors hover:bg-accent"
        >
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          Open in T3
        </a>
      ) : null}
    </div>
  );
}

const Row = memo(function Row({
  thread,
  project,
  now,
  open,
  toggle,
}: {
  thread: Thread;
  project?: string;
  now: number;
  open: boolean;
  toggle: (id: string) => void;
}) {
  const group = groupOf(thread);
  const failed = thread.status === "failed";
  const when = group === "done" ? thread.finishedAt : thread.updatedAt;
  const line = failed ? (thread.lastError ?? thread.lastMessage) : (thread.holding ?? thread.lastMessage);
  const link = useThreadLink(thread.id);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggle(thread.id)}
        className="flex w-full cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/60 aria-expanded:bg-accent/60"
      >
        <span className={cn("mt-[0.45rem] size-2 shrink-0 rounded-full", failed ? "bg-destructive" : dots[group])} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium text-sm">{thread.title || "Untitled"}</span>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{age(when, now)}</span>
          </span>
          <span className="flex min-w-0 gap-1.5 text-[13px] text-muted-foreground">
            {project ? <span className="max-w-[45%] shrink-0 truncate">{project}</span> : null}
            {project && line ? <span aria-hidden="true">·</span> : null}
            <span className={cn("min-w-0 truncate", failed && thread.lastError && "text-destructive")}>{line}</span>
          </span>
        </span>
      </button>
      {thread.requestId && thread.requestKind !== "user_input" ? <Answer thread={thread} /> : null}
      {open ? (
        <div className="flex flex-col gap-2 pt-1 pr-3 pb-3 pl-[2.125rem] text-[13px]">
          {thread.lastMessage ? (
            <p className="line-clamp-[12] whitespace-pre-wrap [overflow-wrap:anywhere]">{thread.lastMessage}</p>
          ) : null}
          {thread.lastError ? (
            <p className="line-clamp-6 whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">
              {thread.lastError}
            </p>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <Detail label="Status" value={thread.needsUser ? `${thread.status}, needs you` : thread.status} />
            <Detail label="Branch" value={thread.branch} />
            <Detail label="Started" value={new Date(thread.createdAt).toLocaleString()} />
            <Detail label="Finished" value={thread.finishedAt && new Date(thread.finishedAt).toLocaleString()} />
          </dl>
          <Actions question={`What's happening with the "${thread.title || "untitled"}" thread?`} link={link} />
        </div>
      ) : null}
    </div>
  );
});

const taskDots: Record<string, string> = {
  waiting: "bg-needs",
  blocked: "bg-destructive",
  done: "bg-done",
};

/** Done tasks stay in view this long, then drop out of the panel (the file stays). */
const doneFor = 7 * 24 * 60 * 60 * 1000;

/** A piece of the user's work, as the assistant keeps it. Opens to show the threads doing it. */
const TaskRow = memo(function TaskRow({
  task,
  now,
  open,
  toggle,
}: {
  task: Task;
  now: number;
  open: boolean;
  toggle: (id: string) => void;
}) {
  const key = `task:${task.slug}`;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggle(key)}
        className="flex w-full cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/60 aria-expanded:bg-accent/60"
      >
        <span
          className={cn(
            "mt-[0.45rem] size-2 shrink-0 rounded-full",
            taskDots[task.status] ?? "bg-working animate-blink",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium text-sm">{task.title}</span>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{age(task.updatedAt, now)}</span>
          </span>
          <span className="min-w-0 truncate text-[13px] text-muted-foreground">
            {task.status === "working" ? task.next : [task.status, task.next].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 pt-1 pr-3 pb-3 pl-[2.125rem] text-[13px]">
          <ul className="flex flex-col gap-1">
            {task.threads.length === 0 ? <li className="text-muted-foreground">No threads yet</li> : null}
            {task.threads.map((id) => (
              <TaskThread key={id} id={id} />
            ))}
          </ul>
          <Actions question={`How is "${task.title}" going?`} />
        </div>
      ) : null}
    </div>
  );
});

/** One of a task's threads: its state, and a link to it in T3 when this device can open one. */
function TaskThread({ id }: { id: string }) {
  const thread = allThreads.get(id);
  const link = useThreadLink(id);
  const title = thread?.title ?? "A thread T3 no longer lists";
  return (
    <li className="flex min-w-0 items-baseline gap-2">
      <span
        className={cn(
          "size-1.5 shrink-0 translate-y-[-1px] rounded-full",
          thread ? dots[groupOf(thread)] : "bg-muted-foreground/40",
        )}
      />
      {link && thread ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
        >
          {title}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate">{title}</span>
      )}
      <span className="shrink-0 text-muted-foreground">{thread?.status}</span>
    </li>
  );
}

/** What a waiting thread asks for, in a few words. */
export const asks: Record<string, string> = {
  command: "wants to run a command",
  "file-change": "wants to change files",
  "file-read": "wants to read files",
  permission: "asks for permission",
};

/**
 * Yes or no to a thread's permission request, right in its row, as the user would answer in T3. The row
 * moves on at once; if T3 doesn't take the answer, the buttons come back and say so.
 */
function Answer({ thread }: { thread: Thread }) {
  const missed = useStore((state) => state.missed === thread.requestId);
  return (
    <div className="flex items-center gap-2 pr-3 pb-2 pl-[2.125rem] text-[13px]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {missed ? "That answer didn't go through" : (asks[thread.requestKind ?? ""] ?? "waits on you")}
      </span>
      <button
        type="button"
        onClick={() => answer(thread, "decline")}
        className="cursor-pointer rounded-md px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent"
      >
        Deny
      </button>
      <button
        type="button"
        onClick={() => answer(thread, "accept")}
        className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-primary-foreground transition-opacity hover:opacity-90"
      >
        Approve
      </button>
    </div>
  );
}

/** Needs you, working, done and unread: the counts on top of the panel. */
function Counts({ activity }: { activity: Activity }) {
  const counts = [
    { label: "need you", count: activity.needs.length, tone: "text-needs" },
    { label: "working", count: activity.working.length, tone: "text-working" },
    { label: "done", count: activity.done.length, tone: "text-done" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {counts.map(({ label, count, tone }) => (
        <div key={label} className="flex flex-col rounded-lg bg-muted/50 px-3 py-2">
          <span
            className={cn(
              "font-semibold text-xl tabular-nums tracking-tight",
              count > 0 ? tone : "text-muted-foreground",
            )}
          >
            {count}
          </span>
          <span className="text-muted-foreground text-xs">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Link({ t3 }: { t3: T3State }) {
  if (t3.state === "connected") return null;
  return (
    <p className="flex items-start gap-2 px-1 text-[13px] text-muted-foreground">
      <span
        className={cn(
          "mt-[0.4rem] size-1.5 shrink-0 rounded-full",
          t3.state === "connecting" ? "animate-blink bg-muted-foreground" : "bg-destructive",
        )}
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {t3.state === "connecting" ? "Connecting to T3 Code" : `T3 Code unavailable: ${t3.reason}`}
      </span>
    </p>
  );
}

type Item =
  | { key: string; title: string }
  | { key: string; task: Task }
  | { key: string; thread: Thread }
  | { key: "fold"; fold: number };

/**
 * The user's work first (the assistant's tasks: open ones, then recently done), then T3's threads in
 * groups, as one flat list, so the panel shows only what is in view however much there is.
 */
function items(tasks: Task[], groups: Activity, older: boolean, now: number): Item[] {
  const out: Item[] = [];
  const shown = [
    ...tasks.filter((task) => task.status !== "done"),
    ...tasks.filter((task) => task.status === "done" && now - Date.parse(task.updatedAt) < doneFor),
  ];
  if (shown.length) {
    out.push({ key: "group:Your work", title: "Your work" });
    for (const task of shown) out.push({ key: `task:${task.slug}`, task });
  }
  const add = (title: string, threads: Thread[]) => {
    if (threads.length === 0) return;
    out.push({ key: `group:${title}`, title });
    for (const thread of threads) out.push({ key: thread.id, thread });
  };
  add("Needs you", groups.needs);
  add("Working", groups.working);
  add("Done, unread", groups.done);
  add("Recent", older ? [...groups.recent, ...groups.older] : groups.recent);
  if (groups.older.length > 0) out.push({ key: "fold", fold: older ? 0 : groups.older.length });
  return out;
}

/** What is going on in T3 Code, grouped by what it needs from the user. */
export function ActivityPanel() {
  const groups = useActivity();
  const t3 = useStore((state) => state.t3);
  const tasks = useStore((state) => state.tasks);
  const projects = useStore((state) => state.projects);
  const names = useMemo(() => new Map(projects.map((project) => [project.id, project.title])), [projects]);
  const now = useNow();
  const [older, setOlder] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // Done tasks drop out by age, which only needs checking now and then.
  const hour = Math.floor(now / 3_600_000);
  const list = useMemo(() => items(tasks, groups, older, hour * 3_600_000), [tasks, groups, older, hour]);
  const scroller = useRef<HTMLDivElement>(null);
  const toggle = useMemo(
    () => (id: string) =>
      setOpen((set) => {
        const next = new Set(set);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const virtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => ("title" in (list[index] as Item) ? 28 : 56),
    getItemKey: (index) => (list[index] as Item).key,
    overscan: 8,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 px-4 pb-3">
        <Counts activity={groups} />
        <Link t3={t3} />
        <Phone />
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground text-sm">Nothing going on</p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const item = list[virtual.index] as Item;
              return (
                <div
                  key={virtual.key}
                  ref={virtualizer.measureElement}
                  data-index={virtual.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${virtual.start}px)` }}
                >
                  {"title" in item ? (
                    <h3
                      className={cn("px-3 pb-1 font-medium text-muted-foreground text-xs", virtual.index > 0 && "pt-4")}
                    >
                      {item.title}
                    </h3>
                  ) : "task" in item ? (
                    <TaskRow task={item.task} now={now} open={open.has(item.key)} toggle={toggle} />
                  ) : "thread" in item ? (
                    <Row
                      thread={item.thread}
                      project={names.get(item.thread.projectId)}
                      now={now}
                      open={open.has(item.thread.id)}
                      toggle={toggle}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOlder(!older)}
                      className="mx-3 mt-2 flex cursor-pointer items-center gap-1.5 rounded-md py-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
                    >
                      <ChevronDownIcon className={cn("size-3.5", older && "rotate-180")} />
                      {older ? "Hide older" : `Show ${item.fold} older`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
