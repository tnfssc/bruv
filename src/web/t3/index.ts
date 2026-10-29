import type { Decision, Project, T3State, Thread } from "../protocol";
import { type FeedEnd, followShell, protocolVersion, rpc, type ShellValue, T3SocketError, ticket } from "./feed";
import { followThreads, type ThreadMessage } from "./follow";
import { keyStore, T3Error } from "./keys";
import { locateT3, type T3Place } from "./locate";
import { sameThread, type T3Thread, toProject, toThread } from "./thread";

export { T3RpcError } from "./feed";
export type { ThreadMessage } from "./follow";

/**
 * bruv's link to T3 Code: a live picture of every project and thread, and a key for T3's MCP server.
 * All knowledge of T3's private protocol stays in this folder.
 */
export type T3Change = {
  t3?: T3State;
  projects?: Project[];
  /** Only the threads that changed. A thread that was archived or deleted comes once more with `away` set, then is gone. */
  threads?: Thread[];
  /** A finished message from a followed thread. */
  message?: ThreadMessage;
};

export type T3Link = {
  state(): T3State;
  projects(): Project[];
  /** Every thread T3 shows, archived ones left out. */
  threads(): Thread[];
  onChange(listener: (change: T3Change) => void): () => void;
  /** Threads whose messages to pass on as they come (`T3Change.message`). */
  follow(ids: Iterable<string>): void;
  /** For Pi's MCP client: T3's /mcp and the header to reach it, signing in when needed. Undefined if T3 can't be reached. */
  mcp(): Promise<{ url: string; headers: Record<string, string> } | undefined>;
  /**
   * Answers a thread's permission request, as the user would in T3 (MCP can't). `accept` once,
   * `acceptForSession` for the rest of the thread's session, or `decline`.
   */
  respond(threadId: string, requestId: string, decision: Decision): Promise<void>;
  /**
   * A signed link on T3's origin to a file T3 lets a reader see (see `T3Asset`), lasting about an hour. No key
   * is needed to fetch it. Throws `T3RpcError` with T3's reason when it won't.
   */
  asset(resource: T3Asset): Promise<{ url: string; expiresAt: number }>;
  /** A text file in a folder of T3's machine, as T3 reads it (text only, cut short when long). */
  readFile(folder: string, path: string): Promise<{ contents: string; truncated: boolean }>;
  /** Pairs with a T3 elsewhere from a `t3 pair` link, and uses it from then on. Answers its origin. */
  pair(link: string): Promise<string>;
  /** Back to the T3 on this machine. False when none was paired from a link. */
  unpair(): boolean;
  close(): void;
};

/**
 * What T3 makes links for. `workspace-file`: a picture, SVG, PDF or HTML page in a thread's folder (a page's
 * link also reaches the files beside it). `media-file`: the same plus video and audio. `attachment`: a page
 * a thread showed with `html_render`.
 */
export type T3Asset =
  | { _tag: "workspace-file" | "media-file"; threadId: string; path: string }
  | { _tag: "attachment"; attachmentId: string; mimeType: "text/html"; disposition: "inline" };

/**
 * T3's own page for this environment, which opens a thread at `<address>/<threadId>`. Public, no key:
 * `/.well-known/t3/environment` names the environment.
 */
async function appAddress(origin: string) {
  try {
    const response = await fetch(`${origin}/.well-known/t3/environment`, { signal: AbortSignal.timeout(5000) });
    const body = (await response.json()) as { environmentId?: unknown };
    return typeof body.environmentId === "string" ? `${origin}/${encodeURIComponent(body.environmentId)}` : undefined;
  } catch {
    return undefined;
  }
}

const firstDelay = 500;
const maxDelay = 10_000;
/** How often to look again when T3 is not there at all. */
const slowDelay = 30_000;

const live = (record: T3Thread) => record.archivedAt == null && record.deletedAt == null;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function reasonFor(error: unknown) {
  if (error instanceof T3Error && error.status === 401) return "T3 refused bruv's key";
  if (error instanceof T3Error) return error.message;
  const cause = (error as { cause?: { code?: string } })?.cause?.code;
  if (cause === "ECONNREFUSED") return "T3 is not running";
  return error instanceof Error ? error.message : String(error);
}

export function connectT3(options: {
  /** bruv's own data folder; keys are saved under it as t3.json with mode 0600. */
  dir: string;
  /** For tests: where T3 is and how to get a pairing token. The default reads ~/.t3 and runs `t3 pair`. */
  locate?: () => T3Place | undefined;
}): T3Link {
  const keys = keyStore(options.dir);
  // A T3 paired from a link wins over the one on this machine.
  const locate = options.locate ?? (() => keys.remote() ?? locateT3());
  const listeners = new Set<(change: T3Change) => void>();
  const threads = new Map<string, Thread>();
  let projects: Project[] = [];
  let state: T3State = { state: "connecting" };
  /** The last feed position applied, so a new connection can resume from it instead of loading everything. */
  let sequence = -1;
  let origin: string | undefined;
  let closed = false;
  let stopFeed: (() => void) | undefined;
  let wake: (() => void) | undefined;

  const emit = (change: T3Change) => {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {}
    }
  };
  const setState = (next: T3State) => {
    if (closed || same(state, next)) return;
    state = next;
    emit({ t3: next });
  };
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  /**
   * Maps T3's records as they arrive and keeps only the mapped threads, so the raw feed can be freed at once.
   * Returns true once the picture is complete: a whole snapshot, or T3's marker after resuming.
   */
  const apply = (values: ShellValue[]) => {
    const changed = new Map<string, Thread>();
    let nextProjects = projects;
    const drop = (id: string) => {
      const old = threads.get(id);
      if (!old) return;
      threads.delete(id);
      changed.set(id, { ...old, away: true });
    };
    const put = (record: T3Thread) => {
      if (!live(record)) return drop(record.id);
      const thread = toThread(record);
      const old = threads.get(record.id);
      threads.set(record.id, thread);
      // A running thread is updated many times a second; most of that never reaches the mapped fields.
      if (!old || !sameThread(old, thread)) changed.set(record.id, thread);
    };
    let complete = false;
    for (const value of values) {
      if (value.kind === "snapshot") {
        if (value.resolvedRepositoryIdentityRoots) continue;
        complete = true;
        sequence = value.snapshot.snapshotSequence;
        const records = value.snapshot.threads.filter(live);
        const ids = new Set(records.map((record) => record.id));
        for (const id of [...threads.keys()]) if (!ids.has(id)) drop(id);
        for (const record of records) put(record);
        nextProjects = value.snapshot.projects.map(toProject);
        continue;
      }
      if (value.kind === "synchronized") {
        complete = true;
        continue;
      }
      if (!(value.sequence > sequence)) continue;
      sequence = value.sequence;
      if (value.kind === "thread.updated") {
        if (value.location === "active") put(value.thread);
        else drop(value.thread.id);
      } else if (value.kind === "thread.removed") drop(value.threadId);
      else if (value.kind === "project.updated") {
        const project = toProject(value.project);
        const known = nextProjects.some((item) => item.id === project.id);
        nextProjects = known
          ? nextProjects.map((item) => (item.id === project.id ? project : item))
          : [...nextProjects, project];
      } else if (value.kind === "project.removed")
        nextProjects = nextProjects.filter((item) => item.id !== value.projectId);
    }
    const change: T3Change = {};
    if (!same(nextProjects, projects)) change.projects = projects = nextProjects;
    if (changed.size) change.threads = [...changed.values()];
    if (change.projects || change.threads) emit(change);
    return complete;
  };

  /** One connection: sign in if needed, follow the feed until it ends. Throws when it can't start. */
  const follow = async (place: T3Place, onLive: () => void): Promise<FeedEnd> => {
    const session = await keys.get("session", place);
    let wsTicket: string;
    try {
      wsTicket = await ticket(place.origin, session);
    } catch (error) {
      if (error instanceof T3Error && error.status === 401) keys.drop("session", session);
      throw error;
    }
    if (closed) return { kind: "closed", reason: "closed" };
    // Positions mean nothing to another T3.
    if (origin !== place.origin) {
      sequence = -1;
      if (origin !== undefined) follower.reset();
    }
    origin = place.origin;
    const feed = followShell(place.origin, wsTicket, sequence < 0 ? undefined : sequence, (values) => {
      if (apply(values) && state.state !== "connected") {
        onLive();
        setState({ state: "connected" });
        void appAddress(place.origin).then((app) => {
          if (app && state.state === "connected" && origin === place.origin) setState({ state: "connected", app });
        });
      }
    });
    stopFeed = feed.close;
    return feed.done;
  };

  const run = async () => {
    let delay = firstDelay;
    let retried = false;
    while (!closed) {
      const place = locate();
      if (!place) {
        setState({ state: "unavailable", reason: "T3 is not installed or not running" });
        await wait(slowDelay);
        continue;
      }
      let pause = delay;
      try {
        const end = await follow(place, () => {
          delay = firstDelay;
          retried = false;
        });
        if (closed) break;
        if (end.kind === "incompatible") {
          setState({
            state: "unavailable",
            reason: `This T3 speaks orchestration protocol ${end.version ?? "unknown"}; bruv speaks ${protocolVersion}`,
          });
          pause = slowDelay;
        } else if (state.state === "connected") {
          setState({ state: "connecting" });
          pause = delay;
        } else
          setState({ state: "unavailable", reason: end.kind === "refused" ? "T3 refused the ticket" : end.reason });
      } catch (error) {
        if (closed) break;
        setState({ state: "unavailable", reason: reasonFor(error) });
        // A refused key was just dropped; sign in again right away, once.
        if (error instanceof T3Error && error.status === 401 && !retried) {
          retried = true;
          continue;
        }
      }
      await wait(pause);
      delay = Math.min(delay * 2, maxDelay);
    }
  };
  const follower = followThreads({
    connect: async () => {
      const place = locate();
      if (!place) return undefined;
      return { origin: place.origin, ticket: await ticket(place.origin, await keys.get("session", place)) };
    },
    onMessage: (message) => emit({ message }),
  });
  void run();

  /** One call to T3's app API with the session key, signing in again once if T3 refused it. */
  const call = async (tag: string, payload: Record<string, unknown>) => {
    const place = locate();
    if (!place) throw new Error("T3 is not running");
    for (let attempt = 0; ; attempt++) {
      const session = await keys.get("session", place);
      try {
        return {
          origin: place.origin,
          value: await rpc(place.origin, await ticket(place.origin, session), tag, payload),
        };
      } catch (error) {
        const refused =
          (error instanceof T3Error && error.status === 401) ||
          (error instanceof T3SocketError && error.status === 401);
        if (!refused || attempt) throw error;
        keys.drop("session", session);
      }
    }
  };

  return {
    state: () => state,
    projects: () => [...projects],
    threads: () => [...threads.values()],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    follow: (ids) => follower.follow(ids),
    async mcp() {
      const place = locate();
      if (!place) return undefined;
      const url = `${place.origin}/mcp`;
      for (let attempt = 0; attempt < 2; attempt++) {
        let token: string;
        try {
          token = await keys.get("mcp", place);
        } catch {
          return undefined;
        }
        // An authorized GET gets 405; a refused key gets 401.
        const status = await fetch(url, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        }).then(
          async (response) => {
            await response.body?.cancel();
            return response.status;
          },
          () => 0,
        );
        if (status === 401) {
          keys.drop("mcp", token);
          continue;
        }
        return { url, headers: { Authorization: `Bearer ${token}` } };
      }
      return undefined;
    },
    async respond(threadId, requestId, decision) {
      await call("orchestration.dispatchCommand", {
        commandId: crypto.randomUUID(),
        type: "runtime-request.respond",
        threadId,
        requestId,
        decision,
      });
    },
    async asset(resource) {
      const { origin, value } = await call("assets.createUrl", { resource });
      const answer = value as { relativeUrl?: unknown; expiresAt?: unknown };
      if (typeof answer?.relativeUrl !== "string") throw new Error("T3 gave no link");
      const expiresAt = typeof answer.expiresAt === "number" ? answer.expiresAt : Date.parse(String(answer.expiresAt));
      return { url: new URL(answer.relativeUrl, origin).href, expiresAt: expiresAt || Date.now() + 10 * 60_000 };
    },
    async readFile(folder, path) {
      const { value } = await call("projects.readFile", { cwd: folder, relativePath: path });
      const answer = value as { contents?: unknown; truncated?: unknown };
      return {
        contents: typeof answer?.contents === "string" ? answer.contents : "",
        truncated: answer?.truncated === true,
      };
    },
    async pair(link) {
      const origin = await keys.pair(link);
      // A new T3: follow it now instead of after the current wait.
      stopFeed?.();
      wake?.();
      return origin;
    },
    unpair() {
      const was = keys.unpair();
      if (was) {
        stopFeed?.();
        wake?.();
      }
      return was;
    },
    close() {
      closed = true;
      follower.close();
      listeners.clear();
      stopFeed?.();
      wake?.();
    },
  };
}
