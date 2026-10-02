import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

const VERSION = 1;
const MAX_PENDING_LAUNCHES = 256;
const MAX_LEDGER_BYTES = 64 * 1024;
const MAX_FINGERPRINT_LENGTH = 128;
const MAX_CLIENT_REQUEST_ID_LENGTH = 128;
type Entry = { fingerprint: string; clientRequestId: string };
type FileShape = { version: 1; pending: Entry[] };

function validEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Entry;
  return (
    typeof entry.fingerprint === "string" &&
    entry.fingerprint.length > 0 &&
    entry.fingerprint.length <= MAX_FINGERPRINT_LENGTH &&
    typeof entry.clientRequestId === "string" &&
    entry.clientRequestId.length > 0 &&
    entry.clientRequestId.length <= MAX_CLIENT_REQUEST_ID_LENGTH
  );
}

function parse(value: string): FileShape {
  const decoded: unknown = JSON.parse(value);
  if (!decoded || typeof decoded !== "object" || (decoded as { version?: unknown }).version !== VERSION)
    throw new Error("Invalid T3 launch identity ledger");
  const pending = (decoded as { pending?: unknown }).pending;
  if (!Array.isArray(pending) || pending.length > MAX_PENDING_LAUNCHES || !pending.every(validEntry))
    throw new Error("Invalid T3 launch identity ledger");
  if (new Set(pending.map((entry) => entry.fingerprint)).size !== pending.length)
    throw new Error("Invalid T3 launch identity ledger");
  if (new Set(pending.map((entry) => entry.clientRequestId)).size !== pending.length)
    throw new Error("Invalid T3 launch identity ledger");
  return { version: VERSION, pending };
}

/** Derive replay identity; read existing mappings without rewriting pending legacy intents. */
export class T3LaunchIdentityLedger {
  constructor(readonly path: string) {}

  static fingerprint(parts: readonly string[]): string {
    if (!parts.length || parts.some((part) => typeof part !== "string" || Buffer.byteLength(part) > 4096))
      throw new Error("Invalid T3 launch intent identity");
    const hash = createHash("sha256");
    for (const part of parts) {
      const bytes = Buffer.from(part);
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(bytes.length);
      hash.update(length).update(bytes);
    }
    return hash.digest("base64url");
  }

  async #read(): Promise<FileShape> {
    let file;
    try {
      file = await open(this.path, "r");
      const stats = await file.stat();
      if (stats.size > MAX_LEDGER_BYTES) throw new Error("T3 launch identity ledger exceeds its size limit");
      return parse(await file.readFile("utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: VERSION, pending: [] };
      throw error;
    } finally {
      await file?.close().catch(() => undefined);
    }
  }

  async reserve(fingerprint: string): Promise<string> {
    if (!fingerprint || fingerprint.length > MAX_FINGERPRINT_LENGTH) throw new Error("Invalid T3 launch fingerprint");
    const ledger = await this.#read();
    // Old pending IDs may use die-v1; deriving bruv-v1 would launch another child.
    const existing = ledger.pending.find((item) => item.fingerprint === fingerprint);
    return existing?.clientRequestId ?? "bruv-v1:" + T3LaunchIdentityLedger.fingerprint([fingerprint]);
  }

  // Delivery ACK must not erase an old identity needed by crash replay.
  async acknowledge(clientRequestId: string): Promise<void> {
    if (!clientRequestId || clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH)
      throw new Error("Invalid T3 launch request identity");
  }
}
