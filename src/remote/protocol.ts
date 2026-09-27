import type { RemoteArtifact, ArtifactPage } from "./artifacts";
import type { RepositoryRequest } from "./repository-wire";
import type { GrantMetadata } from "./capability-runtime";
import type { Reply } from "./capabilities";
export type RemoteRequest =
  | {
      op: "artifact";
      ownerId: string;
      epoch: string;
      taskId: string;
      action: "list" | "get";
      name?: string;
      sha256?: string;
      offset?: number;
    }
  | (RepositoryRequest & { ownerId: string; epoch: string })
  | { op: "cancel"; ownerId: string; epoch: string; taskId: string }
  | { op: "capability-grant"; ownerId: string; epoch: string; taskId: string; grant: GrantMetadata }
  | { op: "capability-revoke"; ownerId: string; epoch: string; taskId: string; grantId: string }
  | { op: "capability-reply"; ownerId: string; epoch: string; taskId: string; reply: Reply }
  | { op: "hello" }
  | {
      op: "launch";
      ownerId: string;
      epoch: string;
      taskId: string;
      repoPath: string;
      prompt: string;
      model?: string;
      thinking?: string;
    }
  | {
      op: "answer";
      ownerId: string;
      epoch: string;
      taskId: string;
      id: string;
      owner: { sessionId: string; branchId: string };
      version: number;
      text: string;
      replyId: string;
    }
  | { op: "sync"; ownerId: string; epoch: string; taskId: string; cursor?: number };

export type RemoteTask = {
  taskId: string;
  state: "accepted" | "running" | "done" | "unknown" | "cancelled";
  repoPath: string;
  profile: { name: "normal"; model: string; thinking?: string };
  error?: string;
  questions?: unknown[];
  artifacts?: RemoteArtifact[];
  artifactError?: string;
  textOutputGap?: string;
  capabilities?: unknown[];
  capabilityNeeds?: unknown[];
  cancelRequested?: boolean;
  reply?: { replyId: string; status: "delivered" | "uncertain" };
};
export type RemoteResponse =
  | { artifacts: RemoteArtifact[] }
  | ArtifactPage
  | { offset: number; checkout?: string; snapshot?: string; result?: unknown; total?: number; data?: string }
  | { accepted: boolean }
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
