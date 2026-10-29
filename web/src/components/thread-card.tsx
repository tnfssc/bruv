import { age } from "@/lib/time";
import { cn } from "@/lib/utils";
import { groupOf } from "@/state/activity";
import { threads } from "@/state/store";
import { useActivity, useNow, useStore } from "@/state/use-store";
import { Actions, Answer, dots, useThreadLink } from "./activity";

/**
 * A thread the assistant started, as a card in the conversation where it started it. It stays live: its
 * state, what it last said and anything it asks of the user update as T3 reports them.
 */
export function ThreadCard({ id, at }: { id: string /** When the card's line was made. */; at: string }) {
  // The grouped threads (with each one's subagents) are worked out once for the panel and every card.
  const { kids: all } = useActivity();
  const connected = useStore((state) => state.t3.state === "connected");
  const now = useNow(60_000);
  const thread = threads.get(id);
  const link = useThreadLink(id);
  if (!thread) {
    // T3 lists a new thread within seconds; one it no longer lists was archived or deleted there.
    const gone = connected && now - Date.parse(at) > 60_000;
    return (
      <div className="rounded-xl bg-card px-3 py-2.5 text-[13px] text-muted-foreground ring-1 ring-foreground/10">
        {gone ? "A thread T3 no longer lists (archived or deleted)" : "Starting a thread…"}
      </div>
    );
  }
  const kids = all.get(id) ?? [];
  const group = groupOf(thread, kids);
  const failed = thread.status === "failed";
  const line = failed ? (thread.lastError ?? thread.lastMessage) : (thread.holding ?? thread.lastMessage);
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex gap-2.5 px-3 pt-2.5 pb-2">
        <span className={cn("mt-[0.45rem] size-2 shrink-0 rounded-full", failed ? "bg-destructive" : dots[group])} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium text-[15px]">{thread.title || "Untitled"}</span>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
              {age(group === "done" ? thread.finishedAt : thread.updatedAt, now)}
            </span>
          </span>
          <span className="text-[13px] text-muted-foreground">
            {thread.needsUser || kids.some((kid) => kid.needsUser)
              ? "needs you"
              : thread.holding
                ? "stopped for now"
                : thread.status}
            {kids.length ? ` · ${kids.length} subagent${kids.length === 1 ? "" : "s"}` : ""}
          </span>
          {line ? (
            <p
              className={cn(
                "mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] [overflow-wrap:anywhere]",
                failed && thread.lastError && "text-destructive",
              )}
            >
              {line}
            </p>
          ) : null}
        </div>
      </div>
      {thread.requestId && thread.requestKind !== "user_input" ? <Answer thread={thread} /> : null}
      {kids
        .filter((kid) => kid.requestId && kid.requestKind !== "user_input")
        .map((kid) => (
          <Answer key={kid.id} thread={kid} who={kid.title} />
        ))}
      <div className="px-3 pb-2.5 pl-[2.125rem]">
        <Actions question={`What's happening with the "${thread.title || "untitled"}" thread?`} link={link} />
      </div>
    </div>
  );
}
