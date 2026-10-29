import { useSyncExternalStore } from "react";

/**
 * On the go: the page made for a phone in a hand or a car mount. A big hold-to-talk button replaces the
 * keyboard, buttons grow, and text gets bigger. Kept per device, since it is about where the device is.
 */
const key = "bruv:go";
let on = localStorage.getItem(key) === "1";
const listeners = new Set<() => void>();

export function setGo(value: boolean) {
  on = value;
  if (value) localStorage.setItem(key, "1");
  else localStorage.removeItem(key);
  for (const listener of listeners) listener();
}

export const useGo = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => on,
  );
