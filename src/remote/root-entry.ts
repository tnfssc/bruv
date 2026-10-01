import { handleRootRequest, runRootOwner } from "./root-owner";
import type { RootRequest } from "./root-contract";
export { runRootOwner };
/** One authenticated SSH process/request, never a local agent or provider. */
export async function runRootControl(): Promise<void> {
  let response: unknown;
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of Bun.stdin.stream()) {
      bytes += chunk.byteLength;
      if (bytes > 1024 * 1024) throw Error("Root request exceeds 1 MiB");
      chunks.push(chunk);
    }
    const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RootRequest;
    response = await handleRootRequest(request);
  } catch (error) {
    response = { code: "root_request_failed", error: String(error) };
  }
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(JSON.stringify(response) + "\n", (error) => (error ? reject(error) : resolve())),
  );
}
