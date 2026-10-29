import { FootprintsIcon, ListChecksIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityPanel } from "./components/activity";
import { Wordmark } from "./components/brand";
import { Composer } from "./components/composer";
import { Conversation } from "./components/conversation";
import { GoPanel } from "./components/go";
import { Button } from "./components/ui/button";
import { onAsked } from "./lib/events";
import { cn } from "./lib/utils";
import { setGo, useGo } from "./state/go";
import { useActivity, useStore } from "./state/use-store";

/** The sheet (Base UI's dialog) only matters on phones, so it is its own chunk. */
const loadSheet = () => import("./components/ui/sheet");
const Sheet = lazy(() => loadSheet().then((module) => ({ default: module.Sheet })));

/** Wide screens keep the activity panel beside the conversation; narrow ones open it over the page. */
const wide = matchMedia("(min-width: 1024px)");
const useWide = () =>
  useSyncExternalStore(
    (listener) => {
      wide.addEventListener("change", listener);
      return () => wide.removeEventListener("change", listener);
    },
    () => wide.matches,
  );

/** Connecting or working, in a fixed width with the dot pinned, so the header never moves. */
function Status() {
  const offline = useStore((state) => state.offline);
  const busy = useStore((state) => state.busy);
  const label = offline ? "Connecting" : busy ? "Working" : "";
  return (
    <div role="status" className="flex items-center gap-2 font-medium text-[13px] text-muted-foreground">
      <span className="min-w-20 text-right">{label}</span>
      <span
        className={cn(
          "size-2 rounded-full transition-colors",
          offline ? "animate-blink bg-muted-foreground" : busy ? "animate-blink bg-working" : "bg-transparent",
        )}
      />
    </div>
  );
}

/** On phones the activity panel opens over the page from this button. */
function ActivityButton({ onClick }: { onClick: () => void }) {
  const groups = useActivity();
  const needs = groups.needs.length;
  const working = groups.working.length;
  return (
    <Button variant="ghost" size="sm" aria-label="Activity" onClick={onClick} onPointerDown={loadSheet}>
      <ListChecksIcon />
      {needs > 0 ? (
        <span className="flex items-center gap-1 text-needs tabular-nums">
          <span className="size-1.5 rounded-full bg-needs" />
          {needs}
        </span>
      ) : null}
      {working > 0 ? (
        <span className="flex items-center gap-1 text-working tabular-nums">
          <span className="size-1.5 rounded-full bg-working" />
          {working}
        </span>
      ) : null}
    </Button>
  );
}

/** On the go: big talk button and big text, for a phone in a hand or a car mount. */
function GoButton() {
  const go = useGo();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="On the go"
      aria-pressed={go}
      onClick={() => setGo(!go)}
      className={cn(go && "bg-accent text-accent-foreground")}
    >
      <FootprintsIcon />
    </Button>
  );
}

export function App() {
  const isWide = useWide();
  const go = useGo();
  const [sheet, setSheet] = useState(false);
  const [sheetUsed, setSheetUsed] = useState(false);
  useEffect(() => {
    if (sheet) setSheetUsed(true);
  }, [sheet]);
  // Asking about something from the panel: show the answer.
  useEffect(() => onAsked(() => setSheet(false)), []);
  // Fetch the sheet's chunk once the page is idle, so the first tap opens it at once.
  useEffect(() => {
    if (isWide) return;
    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 1000));
    idle(() => loadSheet());
  }, [isWide]);
  return (
    <div className="flex h-dvh">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(1rem,env(safe-area-inset-left))]">
          <Wordmark className="h-[1.375rem] shrink-0" />
          <div className="flex items-center gap-1">
            <Status />
            <GoButton />
            {isWide ? null : <ActivityButton onClick={() => setSheet(true)} />}
          </div>
        </header>
        <Conversation />
        {go ? <GoPanel /> : <Composer />}
      </main>
      {isWide ? (
        <aside className="flex w-[22rem] shrink-0 flex-col bg-card">
          <h2 className="px-5 pt-[calc(0.875rem+env(safe-area-inset-top))] pb-3 font-medium text-[15px]">Activity</h2>
          <ActivityPanel />
        </aside>
      ) : sheet || sheetUsed ? (
        <Suspense fallback={null}>
          <Sheet open={sheet} onOpenChange={setSheet} title="Activity">
            <ActivityPanel />
          </Sheet>
        </Suspense>
      ) : null}
    </div>
  );
}
