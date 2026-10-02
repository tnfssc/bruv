import { createHash } from "node:crypto";
import type { RepositoryResult } from "./repository";

export type RepositoryResultPage = { result: RepositoryResult; total: number; offset: number; data: string };

/** Only downloads and verifies bytes. Completion, identity, locks and apply receipts stay with each client. */
export async function downloadRepositoryResult(
  request: (offset: number) => Promise<RepositoryResultPage>,
  snapshot: string,
  maxBytes: number,
  options: { maxPages?: number; pageError?: string; integrityError?: string } = {},
): Promise<{ result: RepositoryResult; patch: Buffer }> {
  const parts: Buffer[] = [];
  let offset = 0;
  let result: RepositoryResult | undefined;
  for (let page = 0; page <= (options.maxPages ?? Infinity); page++) {
    const r = await request(offset);
    const bytes = Buffer.from(r.data ?? "", "base64");
    if (
      bytes.toString("base64") !== r.data ||
      !Number.isSafeInteger(r.total) ||
      r.total < 0 ||
      r.total > maxBytes ||
      bytes.length > 256 * 1024 ||
      r.offset !== offset + bytes.length ||
      r.offset > r.total ||
      (r.offset < r.total && !bytes.length) ||
      (result && JSON.stringify(result) !== JSON.stringify(r.result))
    )
      throw Error(options.pageError ?? "Invalid repository result page");
    result = r.result;
    parts.push(bytes);
    offset = r.offset;
    if (offset === r.total) break;
  }
  const patch = Buffer.concat(parts);
  if (!result || createHash("sha256").update(patch).digest("hex") !== result.sha256 || result.snapshot !== snapshot)
    throw Error(options.integrityError ?? "Repository result digest or snapshot mismatch");
  return { result, patch };
}
