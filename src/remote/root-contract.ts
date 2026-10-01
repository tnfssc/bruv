/** Root placement is a server session with typed presentation facets, never a child or local coordinator. */
export type RootIdentity = { ownerId: string; epoch: string };
export type RootIntent = RootIdentity & {
  sessionId: string;
  role: "root";
  depth: 0;
  repoPath: string;
  model?: string;
  thinking?: string;
};
export type RootCommand =
  | { kind: "prompt"; text: string }
  | { kind: "abort" }
  | { kind: "ui.respond"; id: string; value?: string; confirmed?: boolean; cancelled?: true }
  | { kind: "questions.list" }
  | {
      kind: "questions.answer";
      id: string;
      owner: { sessionId: string; branchId: string };
      version: number;
      text: string;
      replyId: string;
    }
  | { kind: "jobs.list"; cursor?: number | string; count?: number }
  | { kind: "jobs.inspect"; id: string; offset?: number; limit?: number }
  | { kind: "jobs.stop"; id: string }
  | { kind: "close" };
export type RootCommandReceipt = {
  commandId: string;
  state: "queued" | "dispatching" | "completed" | "unknown";
  result?: unknown;
  error?: string;
};
export type RootRecord = {
  intent: RootIntent;
  state: "accepted" | "running" | "closed" | "unknown";
  sessionFile?: string;
  error?: string;
  exitCode?: number;
  model?: unknown;
};
export type RootObservation = {
  record: RootRecord;
  events: Array<{ seq: number; event: unknown }>;
  cursor: number;
  hasMore: boolean;
};
export type RootRequest =
  | { op: "hello" }
  | { op: "create"; intent: RootIntent; requestId: string }
  | (RootIdentity & { op: "observe"; sessionId: string; cursor: number })
  | (RootIdentity & { op: "command"; sessionId: string; commandId: string; command: RootCommand })
  | (RootIdentity & { op: "command-status"; sessionId: string; commandId: string })
  | (RootIdentity & { op: "detach"; sessionId: string })
  | (RootIdentity & {
      op: "repository-upload";
      sessionId: string;
      snapshot: string;
      sha256: string;
      total: number;
      offset: number;
      data: string;
      workspace?: { kind: "inherit" } | { kind: "worktree"; baseRef?: string; branch?: string };
    })
  | (RootIdentity & { op: "repository-result"; sessionId: string; offset: number });
export type RootTransport = (host: string, diePath: string, request: RootRequest) => Promise<unknown>;
