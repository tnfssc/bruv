import { handleRemoteRequest, runOwnerTask } from "./owner";
import type { RemoteRequest, RemoteResponse } from "./protocol";
export type { RemoteRequest, RemoteResponse } from "./protocol";

/** One JSON request per process, one JSON response on stdout. Diagnostics belong on stderr. */
export async function runRemoteControl(): Promise<void> {
  let response: RemoteResponse;
  try {
    const text = await Bun.stdin.text();
    const request = JSON.parse(text) as RemoteRequest;
    if (!request || typeof request !== "object" || !["hello", "launch", "sync"].includes(request.op))
      throw new Error("Invalid request");
    response = await handleRemoteRequest(request);
  } catch (cause) {
    response = { code: "request_failed", error: String(cause) };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
}
export async function runRemoteOwner(taskId: string): Promise<void> {
  await runOwnerTask(taskId);
}
