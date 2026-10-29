import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownIcon, BellIcon } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { onEnd } from "@/lib/events";
import { useMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { askOlder } from "@/state/feed";
import { setFollowing } from "@/state/store";
import { useLine, useLineIds, useStore } from "@/state/use-store";
import type { Line } from "../../../src/web/protocol";
import { Mark } from "./brand";
import { ShownFiles } from "./shown";
import { Button } from "./ui/button";

/** How close to the top, in pixels, before older lines are asked for. */
const nearTop = 800;

function Text({ line, className }: { line: Line; className?: string }) {
  const out = useMarkdown(line.id, line.text);
  return (
    <div className={cn("md", !out && "whitespace-pre-wrap", line.partial && "partial", className)}>
      {out ?? <p>{line.text}</p>}
    </div>
  );
}

function Note({ line }: { line: Line }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "max-w-full cursor-pointer whitespace-pre-wrap text-left text-[13px] text-muted-foreground leading-relaxed opacity-80",
        !open && "line-clamp-4",
      )}
    >
      {line.text}
    </button>
  );
}

/** One line, subscribed on its own: text streaming into it renders only this. */
const Row = memo(function Row({ id }: { id: string }) {
  const line = useLine(id);
  if (!line) return null;
  if (line.role === "user")
    return (
      <div className="ml-auto flex max-w-[min(85%,32rem)] flex-col items-end gap-2 text-right text-muted-foreground">
        {line.images?.length ? (
          <div className="flex flex-wrap justify-end gap-2">
            {/* A fixed height keeps the rows below still as a picture loads; the width follows the picture, so a
                wide screenshot isn't cut. Tapping opens it whole. */}
            {line.images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer" className="block max-w-full">
                <img
                  src={src}
                  alt="Attachment you sent"
                  loading="lazy"
                  decoding="async"
                  className="h-28 w-auto max-w-full rounded-lg bg-card object-contain"
                />
              </a>
            ))}
          </div>
        ) : null}
        {line.text ? (
          <p className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", line.partial && "partial")}>{line.text}</p>
        ) : null}
      </div>
    );
  if (line.role === "assistant" && line.files?.length) return <ShownFiles files={line.files} />;
  if (line.role === "assistant") return <Text line={line} className="text-[17px] leading-[1.65] tracking-[-0.005em]" />;
  if (line.role === "wake")
    return (
      <div className="flex items-start gap-2 text-[13px] text-muted-foreground opacity-80">
        <BellIcon className="mt-[0.2rem] size-3.5 shrink-0" aria-label="Check-in" />
        <Text line={line} className="min-w-0 leading-relaxed" />
      </div>
    );
  return <Note line={line} />;
});

/**
 * Under the last line while the assistant works and nothing is being written yet: a dot, and what it is
 * doing in a few words, so a long run isn't silence.
 */
function Working({ last }: { last?: string }) {
  const busy = useStore((state) => state.busy);
  const step = useStore((state) => state.step);
  const line = useLine(last);
  if (!busy || (line?.role === "assistant" && line.partial)) return null;
  return (
    <span className="mt-5 flex items-center gap-2.5 text-[13px] text-muted-foreground" role="status">
      <span className="block size-2 shrink-0 animate-blink rounded-full bg-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 truncate">{step || "Working"}</span>
    </span>
  );
}

/**
 * The conversation, virtualized so a long one costs what a short one does: only the lines in view (and a
 * few around) are in the page. It follows new lines only when already at the end, asks for older lines near
 * the top, and keeps the view still when they arrive.
 */
export function Conversation() {
  const ids = useLineIds();
  const ready = useStore((state) => state.ready);
  const busy = useStore((state) => state.busy);
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const [away, setAway] = useState(false);

  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 80,
    getItemKey: (index) => ids[index] as string,
    overscan: 6,
    gap: 20,
    paddingStart: 16,
  });
  const total = virtualizer.getTotalSize();

  const end = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atEnd.current = true;
    setFollowing(true);
    setAway(false);
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const now = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (now !== atEnd.current) {
      atEnd.current = now;
      setFollowing(now);
      setAway(!now);
    }
    if (el.scrollTop < nearTop) askOlder();
  };

  // Older lines were put on top: move down by their height so what the user reads stays put.
  const first = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = scroller.current;
    const before = first.current;
    first.current = ids[0];
    if (!el || !before || before === ids[0] || atEnd.current) return;
    const index = ids.indexOf(before);
    const moved = index > 0 ? virtualizer.measurementsCache[index]?.start : undefined;
    if (moved !== undefined) el.scrollTop += moved - 16;
  }, [ids, virtualizer]);

  // Follow the end as lines come and grow, when already there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the content's height changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (atEnd.current) el.scrollTop = el.scrollHeight;
    // Too few lines to scroll: there is nothing to scroll up to, so ask now.
    if (el.scrollTop < nearTop) askOlder();
  }, [total, ids, busy]);

  useEffect(() => onEnd(end), [end]);

  // The composer growing, a phone keyboard opening: stay at the end if there.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        <div aria-live="polite" className="mx-auto max-w-2xl px-[max(1.25rem,env(safe-area-inset-left))] pb-8">
          {ids.length === 0 ? (
            <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-5 text-center">
              <Mark className="h-12 opacity-90" />
              {ready ? (
                <p className="max-w-64 font-medium text-lg text-muted-foreground tracking-tight">
                  What should get done?
                </p>
              ) : null}
            </div>
          ) : (
            <div className="relative w-full" style={{ height: total }}>
              {virtualizer.getVirtualItems().map((item) => (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 flex w-full flex-col"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <Row id={item.key as string} />
                </div>
              ))}
            </div>
          )}
          <Working last={ids.at(-1)} />
        </div>
      </div>
      {away ? (
        <Button
          variant="secondary"
          size="icon"
          aria-label="Go to the end"
          onClick={end}
          round
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-float"
        >
          <ArrowDownIcon />
        </Button>
      ) : null}
    </div>
  );
}
