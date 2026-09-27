import { handleRemoteRequest, runOwnerTask } from "./owner";
import type { RemoteRequest, RemoteResponse } from "./protocol";
export type { RemoteRequest, RemoteResponse } from "./protocol";

/** One JSON request per process, one JSON response on stdout. Diagnostics belong on stderr. */
export async function runRemoteControl(): Promise<void> {
  let response: RemoteResponse;
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of Bun.stdin.stream()) {
      bytes += chunk.byteLength;
      if (bytes > 256 * 1024) throw new Error("Remote request exceeds 256 KiB");
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const request = JSON.parse(text) as RemoteRequest;
    if (!request || typeof request !== "object" || !["hello", "launch", "sync", "answer"].includes(request.op))
      throw new Error("Invalid request");
    const allowed =
      request.op === "hello"
        ? ["op"]
        : request.op === "launch"
          ? ["op", "ownerId", "epoch", "taskId", "repoPath", "prompt", "model", "thinking"]
          : request.op === "answer"
            ? ["op", "ownerId", "epoch", "taskId", "id", "owner", "version", "text", "replyId"]
            : ["op", "ownerId", "epoch", "taskId", "cursor"];
    if (Object.keys(request).some((key) => !allowed.includes(key)))
      throw new Error("Unsupported remote request field (per-task overrides are not supported)");
    response = await handleRemoteRequest(request);
  } catch (cause) {
    response = { code: "request_failed", error: String(cause) };
  }
  process.stdout.write(JSON.stringify(response) + "\n");
}
export async function runRemoteOwner(taskId: string): Promise<void> {
  await runOwnerTask(taskId);
}
