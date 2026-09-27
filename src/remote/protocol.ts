export type RemoteRequest =
  | { op: "hello" }
  | { op: "launch"; ownerId: string; epoch: string; taskId: string; repoPath: string; prompt: string }
  | { op: "sync"; ownerId: string; epoch: string; taskId: string; cursor?: number };

export type RemoteTask = {
  taskId: string;
  state: "accepted" | "running" | "done" | "unknown";
  repoPath: string;
  profile: { name: "normal"; model: string; thinking?: string };
  error?: string;
  questions?: unknown[];
};
export type RemoteResponse =
  | {
      protocol: 1;
      ownerId: string;
      epoch: string;
      version: string;
      platform: string;
      profile: { name: "normal"; model?: string; thinking?: string; auth: "configured" | "missing" | "unknown" };
    }
  | { task: RemoteTask; events: Array<{ seq: number; event: unknown }>; cursor: number; hasMore: boolean }
  | { error: string; code: string };
