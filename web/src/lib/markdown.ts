import { type ReactElement, useSyncExternalStore } from "react";

/**
 * Markdown for the assistant's lines. The renderer is its own chunk, fetched while the socket connects, so
 * the first paint doesn't wait for it; until it lands, lines show as plain text. Rendered lines are kept by
 * id and text, so scrolling a line out and back in doesn't parse it again.
 */
type Render = (text: string) => ReactElement;

let render: Render | undefined;
const waiting = new Set<() => void>();
const cache = new Map<string, { text: string; out: ReactElement }>();
const cacheSize = 400;

export function loadMarkdown() {
  import("./markdown-render").then((module) => {
    render = module.render;
    for (const listener of waiting) listener();
  });
}

const subscribe = (listener: () => void) => {
  waiting.add(listener);
  return () => {
    waiting.delete(listener);
  };
};

/** The line rendered as Markdown, or undefined while the renderer loads. */
export function useMarkdown(id: string, text: string): ReactElement | undefined {
  const ready = useSyncExternalStore(subscribe, () => render);
  if (!ready) return undefined;
  const hit = cache.get(id);
  if (hit && hit.text === text) {
    cache.delete(id);
    cache.set(id, hit);
    return hit.out;
  }
  const out = ready(text);
  cache.delete(id);
  cache.set(id, { text, out });
  if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  return out;
}
