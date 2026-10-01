/** Session-scoped observations from the SSH owner. This source never authorizes actions. */
export type RemoteJobObservation = {
  ownerId: string;
  epoch: string;
  taskId: string;
  title?: string;
  target?: string;
  state: "running" | "unknown" | "done" | "cancelled";
  preview?: string;
  /** A question or capability request requiring user action (not permission to answer/grant). */
  actionable?: string;
};
export type RemoteJobEventSource = {
  publish(observation: RemoteJobObservation): void;
  snapshot(): RemoteJobObservation[];
  subscribe(listener: (observation: RemoteJobObservation) => void): () => void;
};
const sources = new Map<
  string,
  { observations: Map<string, RemoteJobObservation>; listeners: Set<(event: RemoteJobObservation) => void> }
>();
export function remoteJobEvents(sessionFile: string): RemoteJobEventSource {
  let source = sources.get(sessionFile);
  if (!source) {
    source = { observations: new Map(), listeners: new Set() };
    sources.set(sessionFile, source);
  }
  const scoped = source;
  return {
    publish(event) {
      if (!event.ownerId || !event.epoch || !event.taskId) throw new Error("Pinned SSH owner and task required");
      const key = JSON.stringify([event.ownerId, event.epoch, event.taskId]);
      const old = scoped.observations.get(key);
      // A delayed stale refresh cannot reopen a verified terminal task.
      if (old && (old.state === "done" || old.state === "cancelled") && event.state !== old.state) return;
      if (old && JSON.stringify(old) === JSON.stringify(event)) return;
      scoped.observations.set(key, event);
      for (const listener of [...scoped.listeners]) listener(event);
    },
    snapshot: () => [...scoped.observations.values()],
    subscribe(listener) {
      scoped.listeners.add(listener);
      return () => {
        scoped.listeners.delete(listener);
      };
    },
  };
}
/** Discard only the active session's volatile observations on shutdown. */
export function clearRemoteJobEvents(sessionFile: string): void {
  sources.delete(sessionFile);
}
