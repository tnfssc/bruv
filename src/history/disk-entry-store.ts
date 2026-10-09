import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { FileEntry, SessionEntry, SessionHeader } from "@earendil-works/pi-coding-agent";

export const DEFAULT_SESSION_CACHE_BYTES = 4 * 1024 * 1024;

const liveSpools = new Set<string>();
process.once("exit", () => {
  for (const path of liveSpools) {
    try {
      unlinkSync(path);
    } catch {}
  }
});

export interface EntryMetadata {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  offset: number;
  length: number;
  messageRole?: string;
  customType?: string;
  taskProjection?: { rootKey: string; jobId: string };
  messageProvider?: string;
  messageModel?: string;
  firstKeptEntryId?: string;
  thinkingLevel?: string;
  provider?: string;
  modelId?: string;
  targetId?: string;
  label?: string;
  name?: string;
}

/** Custom rows dominate old task journals. Keep their common type and exact
 * canonical timestamp off each resident record; decode timestamp on demand.
 * Noncanonical timestamps retain their original spelling unchanged.
 */
class CustomEntryMetadataBase implements EntryMetadata {
  private time: string | number;
  constructor(
    public id: string,
    public parentId: string | null,
    timestamp: string,
    public offset: number,
    public length: number,
  ) {
    const millis = Date.parse(timestamp);
    this.time = Number.isFinite(millis) && new Date(millis).toISOString() === timestamp ? millis : timestamp;
  }
  get type(): string {
    return "custom";
  }
  get timestamp(): string {
    return typeof this.time === "number" ? new Date(this.time).toISOString() : this.time;
  }
}

const TASK_PROJECTION_CUSTOM_TYPE = "bruv-native-task-projection";
class CustomEntryMetadata extends CustomEntryMetadataBase {
  constructor(
    id: string,
    parentId: string | null,
    timestamp: string,
    offset: number,
    length: number,
    public customType: string | undefined,
  ) {
    super(id, parentId, timestamp, offset, length);
  }
}
// Task checkpoints need one owner key, not a type string plus another slot.
// Keep the common custom type on the prototype to leave six resident fields.
class TaskProjectionMetadata extends CustomEntryMetadataBase {
  constructor(
    id: string,
    parentId: string | null,
    timestamp: string,
    offset: number,
    length: number,
    public taskProjection?: EntryMetadata["taskProjection"],
  ) {
    super(id, parentId, timestamp, offset, length);
  }
  get customType(): string {
    return TASK_PROJECTION_CUSTOM_TYPE;
  }
}

type LocatedEntry = { entry: FileEntry; offset: number; length: number };

/** Read valid JSONL records without keeping the whole file. */
export function scanJsonl(
  path: string,
  visit: (record: LocatedEntry, validIndex: number) => void,
  parse: (line: Buffer) => FileEntry = (line) => JSON.parse(line.toString("utf8")),
): void {
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let fileOffset = 0;
  let lineOffset = 0;
  let lineBuffer = Buffer.allocUnsafe(buffer.length);
  let lineLength = 0;
  const appendFragment = (fragment: Buffer) => {
    if (lineLength + fragment.length > lineBuffer.length) {
      const grown = Buffer.allocUnsafe(Math.max(lineBuffer.length * 2, lineLength + fragment.length));
      lineBuffer.copy(grown, 0, 0, lineLength);
      lineBuffer = grown;
    }
    fragment.copy(lineBuffer, lineLength);
    lineLength += fragment.length;
  };
  let validIndex = 0;
  const consume = (line: Buffer, offset: number) => {
    if (line.length === 0) return;
    let entry: FileEntry;
    try {
      entry = parse(line);
    } catch {
      // Match the SDK: malformed lines are ignored.
      return;
    }
    // SDK load ignores JSON null/false/zero as well as malformed lines.
    if (!entry) return;
    visit({ entry, offset, length: line.length }, validIndex++);
  };
  try {
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, fileOffset);
      if (count === 0) break;
      let start = 0;
      // Search in native code rather than visiting every content byte in JS.
      for (;;) {
        const i = buffer.indexOf(10, start);
        if (i < 0 || i >= count) break;
        // This fragment is consumed before the read buffer is reused. Only
        // unfinished tails below need an owned copy.
        const fragment = buffer.subarray(start, i);
        if (lineLength === 0) consume(fragment, lineOffset);
        else {
          appendFragment(fragment);
          consume(lineBuffer.subarray(0, lineLength), lineOffset);
          lineLength = 0;
        }
        lineOffset = fileOffset + i + 1;
        start = i + 1;
      }
      if (start < count) {
        appendFragment(buffer.subarray(start, count));
      }
      fileOffset += count;
    }
    if (lineLength) consume(lineBuffer.subarray(0, lineLength), lineOffset);
  } finally {
    closeSync(fd);
  }
}

/** Validate JSON while projecting only fields used by the resident index.
 * Skipping values still validates their grammar, but never builds discarded
 * snapshot arrays/objects or decodes their strings. Normal retrieval parses
 * the original bytes with JSON.parse as before.
 */
const JSON_LITERALS = ["true", "false", "null"];
const JSON_ESCAPES = [34, 92, 47, 98, 102, 110, 114, 116];
const EMPTY_BUFFER = Buffer.alloc(0);
class MetadataParser {
  private at = 0;
  private text: Buffer = EMPTY_BUFFER;
  private rootFields = new Set([
    "type",
    "id",
    "parentId",
    "timestamp",
    "customType",
    "firstKeptEntryId",
    "thinkingLevel",
    "provider",
    "modelId",
    "targetId",
    "label",
    "name",
    // Session header fields are needed for reopen, too.
    "version",
    "cwd",
    "parentSession",
  ]);
  private messageFields = new Set(["role", "provider", "model"]);
  private dataFields = new Set<string>();
  private taskRootFields = new Set(["namespace", "sourceSessionId", "sessionId"]);
  private cursorFields = new Set<string>();
  private linkFields = new Set(["jobId"]);
  private fail(): never {
    throw new SyntaxError("Invalid JSON session record");
  }
  private space(): void {
    for (;;) {
      const byte = this.text[this.at];
      if (byte !== 32 && byte !== 9 && byte !== 10 && byte !== 13) return;
      this.at++;
    }
  }
  private token(start: number, end = this.at): unknown {
    return JSON.parse(this.text.subarray(start, end).toString("utf8"));
  }
  private stringEnd(): void {
    if (this.text[this.at++] !== 34) this.fail();
    while (this.at < this.text.length) {
      const byte = this.text[this.at++];
      if (byte === 34) return;
      if (byte < 32) this.fail();
      if (byte !== 92) continue;
      const escapeByte = this.text[this.at++];
      if (escapeByte === 117) {
        for (let i = 0; i < 4; i++) {
          const hex = this.text[this.at++];
          if (!((hex >= 48 && hex <= 57) || (hex >= 65 && hex <= 70) || (hex >= 97 && hex <= 102))) this.fail();
        }
      } else if (!JSON_ESCAPES.includes(escapeByte)) this.fail();
    }
    this.fail();
  }
  private digits(): void {
    const start = this.at;
    while (this.text[this.at] >= 48 && this.text[this.at] <= 57) this.at++;
    if (start === this.at) this.fail();
  }
  private scalar(): void {
    if (this.text[this.at] === 34) {
      this.stringEnd();
      return;
    }
    for (const literal of JSON_LITERALS) {
      if (this.text[this.at] !== literal.charCodeAt(0)) continue;
      for (let i = 0; i < literal.length; i++) if (this.text[this.at++] !== literal.charCodeAt(i)) this.fail();
      return;
    }
    if (this.text[this.at] === 45) this.at++;

    if (this.text[this.at] === 48) this.at++;
    else this.digits();
    if (this.text[this.at] === 46) {
      this.at++;
      this.digits();
    }
    if (this.text[this.at] === 69 || this.text[this.at] === 101) {
      this.at++;
      if (this.text[this.at] === 43 || this.text[this.at] === 45) this.at++;
      this.digits();
    }
  }
  private skipScopes: number[] = [];
  private skipValue(): void {
    const scopes = this.skipScopes;
    scopes.length = 0;
    let state: "value" | "key" | "comma" = "value";
    let empty = false;
    for (;;) {
      this.space();
      const byte = this.text[this.at];
      if (state === "value") {
        if (byte === 123 || byte === 91) {
          scopes.push(byte === 123 ? 125 : 93);
          this.at++;
          state = byte === 123 ? "key" : "value";
          empty = true;
          continue;
        }
        if (byte === 93 && empty && scopes.at(-1) === 93) {
          scopes.pop();
          this.at++;
        } else this.scalar();
        state = "comma";
      } else if (state === "key") {
        if (byte === 125 && empty) {
          scopes.pop();
          this.at++;
          state = "comma";
        } else {
          this.stringEnd();
          this.space();
          if (this.text[this.at++] !== 58) this.fail();
          state = "value";
          empty = false;
        }
      } else {
        if (!scopes.length) return;
        if (byte === scopes.at(-1)) {
          scopes.pop();
          this.at++;
        } else {
          if (byte !== 44) this.fail();
          this.at++;
          state = scopes.at(-1) === 125 ? "key" : "value";
          empty = false;
        }
      }
    }
  }
  private value(fields?: Set<string>, root = false): unknown {
    if (!fields) {
      this.skipValue();
      return;
    }
    this.space();
    const start = this.at;
    if (this.text[this.at] === 123) {
      this.at++;
      const result: Record<string, unknown> = {};
      this.space();
      if (this.text[this.at] === 125) {
        this.at++;
        return result;
      }
      for (;;) {
        this.space();
        const keyStart = this.at;
        this.stringEnd();
        const key = this.token(keyStart) as string;
        this.space();
        if (this.text[this.at++] !== 58) this.fail();
        if (fields.has(key)) {
          this.space();
          const begin = this.at;
          this.value();
          result[key] = this.token(begin);
        } else if (root && key === "message") result[key] = this.value(this.messageFields);
        else if (root && key === "data") result[key] = this.value(this.dataFields);
        else if (fields === this.dataFields && key === "root") result[key] = this.value(this.taskRootFields);
        else if (fields === this.dataFields && key === "cursor") result[key] = this.value(this.cursorFields);
        else if (fields === this.cursorFields && key === "link") result[key] = this.value(this.linkFields);
        else this.value();
        this.space();
        const next = this.text[this.at++];
        if (next === 125) return result;
        if (next !== 44) this.fail();
      }
    }
    if (this.text[this.at] === 91) {
      this.at++;
      this.space();
      if (this.text[this.at] === 93) {
        this.at++;
        return;
      }
      for (;;) {
        this.value();
        this.space();
        const next = this.text[this.at++];
        if (next === 93) return;
        if (next !== 44) this.fail();
      }
    }
    this.scalar();
    // Preserve the SDK's handling of truthy primitive records.
    if (fields) return this.token(start);
  }

  parse(text: Buffer): FileEntry {
    this.at = 0;
    this.text = text;
    try {
      const result = this.value(this.rootFields, true) as
        | { type?: string; customType?: string; data?: { root?: unknown; cursor?: { link?: unknown } } }
        | undefined;
      this.space();
      if (this.at !== text.length) this.fail();
      if (
        result &&
        typeof result === "object" &&
        (result.type !== "custom" ||
          result.customType !== "bruv-native-task-projection" ||
          !result.data?.root ||
          !result.data?.cursor?.link)
      )
        delete result.data;
      return result?.type === "session" ? JSON.parse(text.toString("utf8")) : (result as FileEntry);
    } finally {
      this.text = EMPTY_BUFFER;
    }
  }
}
const metadataParser = new MetadataParser();
export function parseEntryMetadata(text: string): FileEntry {
  return metadataParser.parse(Buffer.from(text));
}

function tempPath(target: string, purpose: string): string {
  return `${target}.${purpose}-${process.pid}-${randomUUID()}`;
}

function writeAll(fd: number, bytes: Buffer): void {
  let written = 0;
  while (written < bytes.length) {
    const count = writeSync(fd, bytes, written, bytes.length - written);
    if (count <= 0) throw new Error("Failed to write session file");
    written += count;
  }
}

function writeLine(fd: number, entry: FileEntry): { offset: number; length: number; bytes: Buffer } {
  const offset = fstatSync(fd).size;
  const bytes = Buffer.from(`${JSON.stringify(entry)}\n`);
  writeAll(fd, bytes);
  return { offset, length: bytes.length - 1, bytes };
}

function atomicReplace(target: string, write: (fd: number) => void, exclusive = false): void {
  // Preserve symlink aliases when rewriting an existing journal. Exclusive
  // creation deliberately uses the requested path and must reject any alias.
  if (!exclusive) {
    try {
      target = realpathSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  const tmp = tempPath(target, "rewrite");
  const fd = openSync(tmp, "wx", 0o600);
  try {
    write(fd);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
  closeSync(fd);
  try {
    if (exclusive) {
      linkSync(tmp, target);
      unlinkSync(tmp);
    } else renameSync(tmp, target);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
}

/** Upgrade old files in two streaming passes. Do not build a whole-file graph. */
export function migrateSessionFile(path: string, version: number): void {
  if (version >= 3) return;
  const ids: Array<string | undefined> = [];
  if (version < 2) {
    const assigned = new Set<string>();
    scanJsonl(path, ({ entry }, index) => {
      if (entry.type === "session") return;
      let id: string;
      do {
        id = randomUUID().slice(0, 8);
      } while (assigned.has(id));
      assigned.add(id);
      ids[index] = id;
    });
  }
  atomicReplace(path, (fd) => {
    let previous: string | null = null;
    scanJsonl(path, ({ entry }, index) => {
      const mutable = entry as unknown as {
        type: string;
        version?: number;
        id?: string;
        parentId?: string | null;
        firstKeptEntryIndex?: number;
        firstKeptEntryId?: string;
        message?: { role: string };
      };
      if (mutable.type === "session") mutable.version = 3;
      else {
        if (version < 2) {
          const id = ids[index];
          if (id === undefined) throw new Error("Missing migrated entry ID");
          mutable.id = id;
          mutable.parentId = previous;
          previous = id;
          if (mutable.type === "compaction" && typeof mutable.firstKeptEntryIndex === "number") {
            mutable.firstKeptEntryId = ids[mutable.firstKeptEntryIndex];
            delete mutable.firstKeptEntryIndex;
          }
        }
        if (mutable.type === "message" && mutable.message?.role === "hookMessage") mutable.message.role = "custom";
      }
      writeLine(fd, mutable as unknown as FileEntry);
    });
  });
}

function ownedString(value: string): string {
  // Preserve UTF-16 code units, including lone surrogates.
  return JSON.parse(JSON.stringify(value)) as string;
}

function metadata(entry: SessionEntry, offset: number, length: number, ownStrings: boolean): EntryMetadata {
  const meta: EntryMetadata =
    entry.type === "custom"
      ? entry.customType === TASK_PROJECTION_CUSTOM_TYPE
        ? new TaskProjectionMetadata(entry.id, entry.parentId, entry.timestamp, offset, length)
        : new CustomEntryMetadata(entry.id, entry.parentId, entry.timestamp, offset, length, entry.customType)
      : {
          type: entry.type,
          id: entry.id,
          parentId: entry.parentId,
          timestamp: entry.timestamp,
          offset,
          length,
        };
  if (entry.type === "message") {
    meta.messageRole = entry.message?.role;
    meta.messageProvider =
      entry.message && typeof entry.message === "object" && "provider" in entry.message
        ? entry.message.provider
        : undefined;
    meta.messageModel =
      entry.message && typeof entry.message === "object" && "model" in entry.message ? entry.message.model : undefined;
  } else if (entry.type === "compaction") meta.firstKeptEntryId = entry.firstKeptEntryId;
  else if (entry.type === "thinking_level_change") meta.thinkingLevel = entry.thinkingLevel;
  else if (entry.type === "model_change") {
    meta.provider = entry.provider;
    meta.modelId = entry.modelId;
  } else if (entry.type === "label") {
    meta.targetId = entry.targetId;
    meta.label = entry.label;
  } else if (entry.type === "session_info") meta.name = entry.name;
  // JSON parsers can return slices backed by the complete input line. The
  // resident index must own its tiny strings, not retain discarded payloads
  // (old task checkpoints can contain very large cursor snapshots).
  if (ownStrings)
    for (const key of Object.keys(meta) as Array<keyof EntryMetadata>) {
      const value = meta[key];
      if (typeof value === "string") (meta as unknown as Record<string, unknown>)[key] = ownedString(value);
    }
  return meta;
}

export function metadataSkeleton(meta: EntryMetadata): SessionEntry {
  return {
    type: meta.type,
    id: meta.id,
    parentId: meta.parentId,
    timestamp: meta.timestamp,
    ...(meta.type === "custom" ? { customType: meta.customType } : {}),
    ...(meta.type === "session_info" ? { name: meta.name } : {}),
  } as SessionEntry;
}

export class DiskEntryStore {
  readonly targetPath: string;
  readonly budgetBytes: number;
  header!: SessionHeader;
  entries: EntryMetadata[] = [];
  byId = new Map<string, EntryMetadata>();
  private activePath: string;
  private spoolPath?: string;
  private sharedStrings = new Map<string, string>();
  private taskRoots = new Map<
    string,
    Map<
      string,
      Map<
        string,
        {
          rootKey: string;
          jobs: Map<string, NonNullable<EntryMetadata["taskProjection"]>>;
        }
      >
    >
  >();

  /** Intern vocabulary and task keys only after the record is committed. */
  private registerMetadata(meta: EntryMetadata, entry: SessionEntry): EntryMetadata {
    if (meta.customType === TASK_PROJECTION_CUSTOM_TYPE) {
      const data = (
        entry as SessionEntry & {
          data?: {
            root?: { namespace?: unknown; sourceSessionId?: unknown; sessionId?: unknown };
            cursor?: { link?: { jobId?: unknown } };
          };
        }
      ).data;
      const root = data?.root,
        jobId = data?.cursor?.link?.jobId;
      if (
        root &&
        typeof root.namespace === "string" &&
        typeof root.sourceSessionId === "string" &&
        typeof root.sessionId === "string" &&
        typeof jobId === "string"
      ) {
        let sources = this.taskRoots.get(root.namespace);
        if (!sources) {
          sources = new Map();
          this.taskRoots.set(root.namespace, sources);
        }
        let sessions = sources.get(root.sourceSessionId);
        if (!sessions) {
          sessions = new Map();
          sources.set(root.sourceSessionId, sessions);
        }
        let owner = sessions.get(root.sessionId);
        if (!owner) {
          owner = {
            rootKey: JSON.stringify([root.namespace, root.sourceSessionId, root.sessionId]),
            jobs: new Map(),
          };
          sessions.set(root.sessionId, owner);
        }
        let key = owner.jobs.get(jobId);
        if (!key) {
          key = { rootKey: owner.rootKey, jobId: ownedString(jobId) };
          owner.jobs.set(jobId, key);
        }
        meta.taskProjection = key;
      }
    }
    // IDs and parent links name the same index nodes. Reuse their owned strings.
    if (meta.parentId) meta.parentId = this.byId.get(meta.parentId)?.id ?? meta.parentId;
    // These are vocabulary, not user payload: hundreds of thousands of old
    // checkpoints must not each own another copy of their type/model names.
    for (const key of [
      "type",
      "customType",
      "messageRole",
      "messageProvider",
      "messageModel",
      "thinkingLevel",
      "provider",
      "modelId",
    ] as const) {
      if (key === "type" && meta.type === "custom") continue;
      if (key === "customType" && meta.customType === TASK_PROJECTION_CUSTOM_TYPE) continue;
      const value = meta[key];
      if (value === undefined) continue;
      const shared = this.sharedStrings.get(value);
      if (shared !== undefined) meta[key] = shared;
      else this.sharedStrings.set(value, value);
    }
    return meta;
  }
  // Cache serialized bytes, not parsed object graphs: the data budget is exact
  // even when JSON expands into many small JS objects. Parsed entries belong
  // only to callers and are never retained by the store.
  private cache = new Map<string, Buffer>();
  private cacheBytes = 0;
  private hasConversation = false;

  private constructor(targetPath: string, budgetBytes: number, activePath: string) {
    this.targetPath = resolve(targetPath);
    this.budgetBytes = budgetBytes;
    this.activePath = activePath;
  }

  get flushed(): boolean {
    return this.activePath === this.targetPath;
  }

  static open(path: string, budgetBytes = DEFAULT_SESSION_CACHE_BYTES): DiskEntryStore {
    const target = resolve(path);
    const store = new DiskEntryStore(target, budgetBytes, target);
    store.rescan();
    // Native persistent open repairs an unterminated tail only after validating
    // the session. This is never used by cross-session read-only retrieval.
    const fd = openSync(target, "r");
    let needsNewline = false;
    try {
      const size = fstatSync(fd).size;
      if (size > 0) {
        const last = Buffer.allocUnsafe(1);
        readSync(fd, last, 0, 1, size - 1);
        needsNewline = last[0] !== 10;
      }
    } finally {
      closeSync(fd);
    }
    if (needsNewline) {
      const appendFd = openSync(target, "a");
      try {
        writeAll(appendFd, Buffer.from("\n"));
      } finally {
        closeSync(appendFd);
      }
    }
    return store;
  }

  static pending(path: string, header: SessionHeader, budgetBytes = DEFAULT_SESSION_CACHE_BYTES): DiskEntryStore {
    const target = resolve(path);
    mkdirSync(dirname(target), { recursive: true });
    const spool = tempPath(target, "pending");
    const fd = openSync(spool, "wx", 0o600);
    try {
      writeLine(fd, header);
      fsyncSync(fd);
    } catch (error) {
      try {
        unlinkSync(spool);
      } catch {}
      throw error;
    } finally {
      closeSync(fd);
    }
    const store = new DiskEntryStore(target, budgetBytes, spool);
    store.spoolPath = spool;
    liveSpools.add(spool);
    store.header = header;
    return store;
  }

  static published(
    path: string,
    header: SessionHeader,
    budgetBytes = DEFAULT_SESSION_CACHE_BYTES,
    exclusive = false,
  ): DiskEntryStore {
    const target = resolve(path);
    atomicReplace(
      target,
      (fd) => {
        writeLine(fd, header);
      },
      exclusive,
    );
    return DiskEntryStore.open(target, budgetBytes);
  }

  static fromEntries(
    path: string,
    header: SessionHeader,
    entries: Iterable<SessionEntry>,
    flushed: boolean,
    budgetBytes = DEFAULT_SESSION_CACHE_BYTES,
  ): DiskEntryStore {
    if (!flushed) {
      const store = DiskEntryStore.pending(path, header, budgetBytes);
      try {
        for (const entry of entries) store.append(entry);
        return store;
      } catch (error) {
        store.dispose();
        throw error;
      }
    }
    const target = resolve(path);
    atomicReplace(target, (fd) => {
      writeLine(fd, header);
      for (const entry of entries) writeLine(fd, entry);
    });
    return DiskEntryStore.open(target, budgetBytes);
  }

  dispose(): void {
    if (this.spoolPath) {
      try {
        unlinkSync(this.spoolPath);
      } catch {}
      liveSpools.delete(this.spoolPath);
      this.spoolPath = undefined;
    }
    this.cache.clear();
    this.cacheBytes = 0;
  }

  append(entry: SessionEntry): EntryMetadata {
    const fd = openSync(this.activePath, "a+");
    let location: { offset: number; length: number; bytes: Buffer };
    let meta: EntryMetadata;
    try {
      const size = fstatSync(fd).size;
      let rollbackFailure = "Session append and rollback failed";
      try {
        if (size > 0) {
          const last = Buffer.allocUnsafe(1);
          readSync(fd, last, 0, 1, size - 1);
          if (last[0] !== 10) writeAll(fd, Buffer.from("\n"));
        }
        location = writeLine(fd, entry);
        meta = metadata(entry, location.offset, location.length, true);
        if (
          !this.flushed &&
          (this.hasConversation || meta.messageRole === "user" || meta.messageRole === "assistant")
        ) {
          rollbackFailure = "Session publication and rollback failed";
          this.publish();
        }
      } catch (error) {
        // Writing and first-conversation publication are one transaction. Keep
        // the original tail and leave indexes untouched so the manager can retry.
        try {
          ftruncateSync(fd, size);
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], rollbackFailure);
        }
        throw error;
      }
    } finally {
      closeSync(fd);
    }
    this.registerMetadata(meta, entry);
    this.entries.push(meta);
    this.byId.set(meta.id, meta);
    this.remember(location.bytes, meta);
    this.hasConversation ||= meta.messageRole === "user" || meta.messageRole === "assistant";
    return meta;
  }

  private publish(): void {
    if (!this.spoolPath) return;
    const spool = this.spoolPath;
    linkSync(spool, this.targetPath);
    this.spoolPath = undefined;
    this.activePath = this.targetPath;
    try {
      unlinkSync(spool);
      liveSpools.delete(spool);
    } catch {
      // Publication succeeded; a failed redundant-link cleanup must not turn
      // the persisted session into a failed append. Retry cleanup on exit.
    }
  }

  materialize(metaOrId: EntryMetadata | string): SessionEntry {
    const meta = typeof metaOrId === "string" ? this.byId.get(metaOrId) : metaOrId;
    if (!meta) throw new Error(`Entry ${String(metaOrId)} not found`);
    const cacheKey = this.cacheKey(meta);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return JSON.parse(cached.toString("utf8")) as SessionEntry;
    }
    const fd = openSync(this.activePath, "r");
    const bytes = Buffer.allocUnsafe(meta.length);
    try {
      let read = 0;
      while (read < bytes.length) {
        const count = readSync(fd, bytes, read, bytes.length - read, meta.offset + read);
        if (count === 0) throw new Error(`Unexpected end of session file: ${this.activePath}`);
        read += count;
      }
    } finally {
      closeSync(fd);
    }
    const entry = JSON.parse(bytes.toString("utf8")) as SessionEntry;
    this.remember(bytes, meta);
    return entry;
  }

  materializeAll(): SessionEntry[] {
    return this.entries.map((entry) => this.materialize(entry));
  }

  private rescan(): void {
    this.entries = [];
    this.byId.clear();
    this.sharedStrings.clear();
    this.taskRoots.clear();
    this.cache.clear();
    this.cacheBytes = 0;
    let header: SessionHeader | undefined;
    this.hasConversation = false;
    scanJsonl(
      this.activePath,
      ({ entry, offset, length }, index) => {
        if (index === 0 && (entry.type !== "session" || typeof entry.id !== "string"))
          throw new Error(`Session file has no valid initial header: ${this.targetPath}`);
        if (entry.type === "session") {
          header ??= entry as SessionHeader;
          return;
        }
        // Selected tokens were decoded from their own byte views, not a full-row
        // JS string. They already own their small backing storage.
        const meta = this.registerMetadata(
          metadata(entry as SessionEntry, offset, length, false),
          entry as SessionEntry,
        );
        this.entries.push(meta);
        this.byId.set(meta.id, meta);
        this.hasConversation ||= meta.messageRole === "user" || meta.messageRole === "assistant";
      },
      (line) => metadataParser.parse(line),
    );
    if (!header) throw new Error(`Session file has no header: ${this.targetPath}`);
    this.header = header;
  }

  private cacheKey(meta: EntryMetadata): string {
    return `${meta.offset}:${meta.length}`;
  }

  private remember(bytes: Buffer, meta: EntryMetadata): void {
    if (bytes.length > this.budgetBytes) return;
    const key = this.cacheKey(meta);
    const old = this.cache.get(key);
    if (old) this.cacheBytes -= old.length;
    this.cache.delete(key);
    this.cache.set(key, bytes);
    this.cacheBytes += bytes.length;
    while (this.cacheBytes > this.budgetBytes) {
      const oldest = this.cache.entries().next().value;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.cacheBytes -= oldest[1].length;
    }
  }
}

/** Read the first parsed record without loading or changing the journal. */
export function readSessionFileHeader(path: string): SessionHeader | undefined {
  const done = Symbol("session-header-found");
  let header: SessionHeader | undefined;
  try {
    scanJsonl(path, ({ entry }) => {
      if (entry.type === "session" && typeof entry.id === "string") header = entry;
      throw done;
    });
  } catch (error) {
    if (error !== done) throw error;
  }
  return header;
}

export function sessionFileVersion(path: string): number | undefined {
  const header = readSessionFileHeader(path);
  if (!header) throw new Error(`Session file has no valid initial header: ${path}`);
  return header.version ?? 1;
}
