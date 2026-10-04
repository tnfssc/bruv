import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskManager } from "./task-manager";

/** An attachment to the existing authority, never a new manager or scheduler. */
export interface TaskOwnerAttachment {
  manager: TaskManager;
  context: ExtensionContext;
  sourceSessionId: string;
  appendEntry(type: string, data: unknown): void;
}
export interface TaskOwnerBinding {
  close(): Promise<void>;
}
export type TaskOwnerObserver = (owner: TaskOwnerAttachment) => TaskOwnerBinding;
