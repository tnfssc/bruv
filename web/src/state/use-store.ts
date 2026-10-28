import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Line } from "../../../src/web/protocol";
import { type Activity, activity } from "./activity";
import { withAnswers } from "./optimistic";
import { getLine, getState, type State, subscribe, subscribeLine, threads } from "./store";

/** One piece of the page's state; the component renders again only when that piece changes. */
export function useStore<T>(pick: (state: State) => T): T {
  return useSyncExternalStore(subscribe, () => pick(getState()));
}

/** One line; only this line's component renders again as it grows. */
export function useLine(id: string | undefined): Line | undefined {
  const sub = useMemo(() => (listener: () => void) => (id ? subscribeLine(id, listener) : () => {}), [id]);
  return useSyncExternalStore(sub, () => (id ? getLine(id) : undefined));
}

/** The conversation's line ids in order, with lines still on their way at the end. */
export function useLineIds(): string[] {
  const ids = useStore((state) => state.ids);
  const sending = useStore((state) => state.sending);
  return useMemo(() => (sending.length ? [...ids, ...sending] : ids), [ids, sending]);
}

/** The time, ticking every `every` ms, for ages like "5m". */
export function useNow(every = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

/** The panel's sorted threads, worked out again only when threads change or a minute passes. */
export function useActivity(): Activity {
  const version = useStore((state) => state.threadsVersion);
  const now = useNow(60_000);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `threads` changes in place; `version` says when
  return useMemo(() => activity(withAnswers(threads.values()), now), [version, now]);
}
