import type { IncomingMessage, Server, ServerResponse } from "node:http";

/** Answers a request and returns true, or returns false to leave it to the next route. */
export type Route = (
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
) => boolean | Promise<boolean | undefined>;

/** What the web version gives each part when its server is up. */
export type WebContext = {
  /** The HTTP server, for the part's own sockets. Check the page key with `allowed` from ./server. */
  http: Server;
  /** Adds the part's own HTTP routes, tried before the page's files. Returns a remover. */
  route(handler: Route): () => void;
  key: string;
  /** bruv's data folder for the web version (`~/.pi/agent/bruv/web`). */
  dir: string;
  agentDir: string;
  /** The address the page is reached at, with its key: the tunnel's when there is one, else the local one. */
  address(): string;
  /** The tunnel sets its address here when it is up, and clears it when it stops. */
  setAddress(url: string | undefined): void;
  /** Words from the user (typed or spoken) for the assistant, as if sent from the page. */
  say(text: string): void;
  /** Stop what the assistant is doing now. */
  stop(): void;
  /** Whether some page is open and in front, so the user sees new lines without being told. */
  watched(): boolean;
  /** A provider's API key from Pi (environment, auth.json, /login), as the model registry gives it. */
  apiKey(provider: string): Promise<string | undefined>;
  /** Tell the person at the terminal (Pi's notify), when there is one. */
  notify(text: string, kind?: "info" | "error"): void;
};

/** What the assistant is doing, for parts that follow it (voice speaks replies). */
export type Reply =
  | { type: "start"; id: string }
  | { type: "delta"; id: string; text: string }
  | { type: "end"; id: string; text: string };

/**
 * A part of the web version: voice, push, the tunnel. Each owns its own routes, sockets and state; the
 * web version starts them with the server and passes on what they follow.
 */
export type WebPart = {
  name: string;
  start(web: WebContext): Promise<void> | void;
  /** The assistant's written reply as it streams. */
  reply?(event: Reply): void;
  /** A run started or settled. */
  busy?(busy: boolean): void;
  /** Whether the user is talking right now, so a wake-up waits rather than cutting in. */
  talking?(): boolean;
  /** The assistant said something the user should hear about while away (a wake-up's reply). */
  news?(text: string): void;
  close(): Promise<void> | void;
};
