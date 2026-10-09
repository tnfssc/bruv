import { handleRemoteRequest, runOwnerTask } from "./owner";
import type { RemoteRequest, RemoteResponse } from "./protocol";
export type { RemoteRequest, RemoteResponse } from "./protocol";

/** Keep the compiled stdin boundary aligned with the strict placed-task wire contract. */
export function validateRemoteRequestFields(request: RemoteRequest): void {
  const fields: Record<string, string[]> = {
    artifact: ["action", "name", "sha256", "offset"],
    hello: [],
    launch: ["repoPath", "prompt", "model", "thinking", "placement"],
    sync: ["cursor"],
    answer: ["id", "owner", "version", "text", "replyId"],
    cancel: [],
    "repository-upload": ["snapshot", "sha256", "total", "offset", "data", "workspace"],
    "repository-result": ["offset"],
    "capability-grant": ["grant"],
    "capability-revoke": ["grantId"],
    "capability-reply": ["reply"],
  };
  if (!request || typeof request !== "object" || !Object.hasOwn(fields, request.op)) throw Error("Invalid request");
  const allowed = ["op", ...(request.op === "hello" ? [] : ["ownerId", "epoch", "taskId"]), ...fields[request.op]];
  if (Object.keys(request).some((key) => !allowed.includes(key))) throw Error("Unsupported remote request field");
}

/** One JSON request per process, one JSON response on stdout. Diagnostics belong on stderr. */
export async function runRemoteControl(): Promise<void> {
  let response: RemoteResponse;
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of Bun.stdin.stream()) {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) throw new Error("Remote request exceeds 1 MiB");
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const request = JSON.parse(text) as RemoteRequest;
    validateRemoteRequestFields(request);
    response = await handleRemoteRequest(request);
  } catch (cause) {
    response = { code: "request_failed", error: String(cause) };
  }
  // CLI exits explicitly after this promise: wait for the complete pipe write, not just enqueueing it.
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(`${JSON.stringify(response)}\n`, (error) => (error ? reject(error) : resolve())),
  );
}
export async function runRemoteOwner(taskId: string): Promise<void> {
  await runOwnerTask(taskId);
}
